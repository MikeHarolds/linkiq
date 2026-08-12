import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DomainStatus, type CustomDomain } from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { isUniqueConstraintViolation } from '../../common/utils/prisma-errors';
import { AuditService } from '../audit/audit.service';
import { BillingUsageService } from '../billing/billing-usage.service';
import { PrismaService } from '../prisma/prisma.service';

import { DomainCacheService } from './domain-cache.service';
import { DomainResolverService } from './domain-resolver.service';
import type { CreateDomainDto } from './dto/create-domain.dto';
import type { QueryDomainsDto } from './dto/query-domains.dto';
import type { UpdateDomainDto } from './dto/update-domain.dto';
import { validateDomainFormat } from './utils/domain-normalization';
import {
  DOMAIN_VERIFICATION_PROVIDER,
  generateVerificationToken,
  type DomainVerificationProvider,
} from './verification/domain-verification.provider';

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

/** Statuses from which a domain is eligible to be selected for a link or
 * set as primary — verification has succeeded at least once. */
const SELECTABLE_STATUSES: DomainStatus[] = [
  DomainStatus.VERIFIED,
  DomainStatus.ACTIVE,
];

@Injectable()
export class DomainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cache: DomainCacheService,
    private readonly resolver: DomainResolverService,
    @Inject(DOMAIN_VERIFICATION_PROVIDER)
    private readonly verificationProvider: DomainVerificationProvider,
    private readonly billingUsage: BillingUsageService,
  ) {}

  private assertNotReservedHost(normalizedDomain: string): void {
    if (this.resolver.isDefaultHost(normalizedDomain)) {
      throw new BadRequestException(
        'This hostname is reserved for the default LinkIQ domain',
      );
    }
  }

  async create(
    workspaceId: string,
    userId: string,
    dto: CreateDomainDto,
    ctx: RequestContext,
  ): Promise<CustomDomain> {
    const validation = validateDomainFormat(dto.domain);
    if (!validation.valid) {
      throw new BadRequestException(validation.reason ?? 'Invalid domain');
    }
    const normalizedDomain = validation.normalized!;
    this.assertNotReservedHost(normalizedDomain);
    await this.billingUsage.assertCanUse(
      workspaceId,
      'MAX_CUSTOM_DOMAINS',
      'custom domains',
    );

    try {
      const domain = await this.prisma.customDomain.create({
        data: {
          workspaceId,
          domain: dto.domain.trim(),
          normalizedDomain,
          verificationToken: generateVerificationToken(),
          createdById: userId,
        },
      });

      await this.audit.record({
        action: 'domain.created',
        entity: 'CustomDomain',
        entityId: domain.id,
        userId,
        workspaceId,
        metadata: { domain: normalizedDomain },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return domain;
    } catch (error) {
      // Same TOCTOU-avoiding pattern as LinksService: rely on the DB's
      // unique constraint on normalizedDomain rather than a pre-check.
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          'This domain is already registered in LinkIQ',
        );
      }
      throw error;
    }
  }

  async findAll(
    workspaceId: string,
    query: QueryDomainsDto,
  ): Promise<PaginatedResult<CustomDomain>> {
    const searchTerm = query.search?.trim();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Record<string, unknown> = {
      workspaceId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(searchTerm
        ? { domain: { contains: searchTerm, mode: 'insensitive' } }
        : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.customDomain.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customDomain.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
      },
    };
  }

  async findByIdOrThrow(
    workspaceId: string,
    domainId: string,
  ): Promise<CustomDomain> {
    const domain = await this.prisma.customDomain.findUnique({
      where: { id: domainId },
    });
    if (!domain || domain.deletedAt !== null) {
      throw new NotFoundException('Domain not found');
    }
    if (domain.workspaceId !== workspaceId) {
      // 404, not 403 — same reasoning as LinksService/QrCodesService.
      throw new NotFoundException('Domain not found');
    }
    return domain;
  }

  /** Only usable by LinksService when validating a link's chosen
   * customDomainId — throws 404 on cross-workspace access, and 400 if the
   * domain isn't yet eligible to be attached to a link. */
  async findSelectableOrThrow(
    workspaceId: string,
    domainId: string,
  ): Promise<CustomDomain> {
    const domain = await this.findByIdOrThrow(workspaceId, domainId);
    if (!SELECTABLE_STATUSES.includes(domain.status)) {
      throw new BadRequestException(
        'Only a verified or active domain can be selected for a link',
      );
    }
    return domain;
  }

  async update(
    workspaceId: string,
    domainId: string,
    userId: string,
    dto: UpdateDomainDto,
    ctx: RequestContext,
  ): Promise<CustomDomain> {
    const existing = await this.findByIdOrThrow(workspaceId, domainId);

    if (dto.domain === undefined) {
      return existing;
    }

    if (
      existing.status !== DomainStatus.PENDING &&
      existing.status !== DomainStatus.FAILED
    ) {
      throw new BadRequestException(
        'Cannot change the hostname of a domain that has already been verified — delete and re-add it instead',
      );
    }

    const validation = validateDomainFormat(dto.domain);
    if (!validation.valid) {
      throw new BadRequestException(validation.reason ?? 'Invalid domain');
    }
    const normalizedDomain = validation.normalized!;
    this.assertNotReservedHost(normalizedDomain);

    try {
      const updated = await this.prisma.customDomain.update({
        where: { id: domainId },
        data: {
          domain: dto.domain.trim(),
          normalizedDomain,
          status: DomainStatus.PENDING,
          verificationToken: generateVerificationToken(),
          verifiedAt: null,
          verificationCheckedAt: null,
        },
      });
      await this.cache.invalidate(existing.normalizedDomain);

      await this.audit.record({
        action: 'domain.updated',
        entity: 'CustomDomain',
        entityId: domainId,
        userId,
        workspaceId,
        metadata: { domain: normalizedDomain },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return updated;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          'This domain is already registered in LinkIQ',
        );
      }
      throw error;
    }
  }

  async verify(
    workspaceId: string,
    domainId: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<CustomDomain> {
    const existing = await this.findByIdOrThrow(workspaceId, domainId);

    await this.prisma.customDomain.update({
      where: { id: domainId },
      data: { status: DomainStatus.VERIFYING },
    });
    await this.audit.record({
      action: 'domain.verification_requested',
      entity: 'CustomDomain',
      entityId: domainId,
      userId,
      workspaceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    const verified = await this.verificationProvider.check(
      existing.normalizedDomain,
      existing.verificationToken,
    );

    const updated = await this.prisma.customDomain.update({
      where: { id: domainId },
      data: verified
        ? {
            status: DomainStatus.VERIFIED,
            verifiedAt: new Date(),
            verificationCheckedAt: new Date(),
          }
        : {
            status: DomainStatus.FAILED,
            verificationCheckedAt: new Date(),
          },
    });
    await this.cache.invalidate(existing.normalizedDomain);

    await this.audit.record({
      action: verified ? 'domain.verified' : 'domain.verification_failed',
      entity: 'CustomDomain',
      entityId: domainId,
      userId,
      workspaceId,
      metadata: { normalizedDomain: existing.normalizedDomain },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  async activate(
    workspaceId: string,
    domainId: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<CustomDomain> {
    const existing = await this.findByIdOrThrow(workspaceId, domainId);

    // VERIFIED (first activation) or DISABLED (re-activation) both imply
    // verifiedAt is already set — PENDING/VERIFYING/FAILED never do.
    if (
      existing.status !== DomainStatus.VERIFIED &&
      existing.status !== DomainStatus.DISABLED
    ) {
      throw new BadRequestException('Only a verified domain can be activated');
    }

    const updated = await this.prisma.customDomain.update({
      where: { id: domainId },
      data: { status: DomainStatus.ACTIVE },
    });
    await this.cache.invalidate(existing.normalizedDomain);

    await this.audit.record({
      action: 'domain.activated',
      entity: 'CustomDomain',
      entityId: domainId,
      userId,
      workspaceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  async disable(
    workspaceId: string,
    domainId: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<CustomDomain> {
    const existing = await this.findByIdOrThrow(workspaceId, domainId);

    if (existing.status !== DomainStatus.ACTIVE) {
      throw new BadRequestException('Only an active domain can be disabled');
    }

    // Clearing isPrimary too: a disabled domain shouldn't remain the
    // workspace's suggested branded domain. Links keep customDomainId
    // untouched — they just stop resolving through this host until
    // re-activated (see RedirectService/DomainResolverService).
    const updated = await this.prisma.customDomain.update({
      where: { id: domainId },
      data: { status: DomainStatus.DISABLED, isPrimary: false },
    });
    await this.cache.invalidate(existing.normalizedDomain);

    await this.audit.record({
      action: 'domain.disabled',
      entity: 'CustomDomain',
      entityId: domainId,
      userId,
      workspaceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  async setPrimary(
    workspaceId: string,
    domainId: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<CustomDomain> {
    const existing = await this.findByIdOrThrow(workspaceId, domainId);

    if (!SELECTABLE_STATUSES.includes(existing.status)) {
      throw new BadRequestException(
        'Only a verified or active domain can be set as primary',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.customDomain.updateMany({
        where: { workspaceId, isPrimary: true, id: { not: domainId } },
        data: { isPrimary: false },
      });
      return tx.customDomain.update({
        where: { id: domainId },
        data: { isPrimary: true },
      });
    });

    await this.audit.record({
      action: 'domain.primary_changed',
      entity: 'CustomDomain',
      entityId: domainId,
      userId,
      workspaceId,
      metadata: { normalizedDomain: existing.normalizedDomain },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  async softDelete(
    workspaceId: string,
    domainId: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const existing = await this.findByIdOrThrow(workspaceId, domainId);

    await this.prisma.$transaction(async (tx) => {
      await tx.customDomain.update({
        where: { id: domainId },
        data: { deletedAt: new Date(), isPrimary: false },
      });
      // Explicit application-level "SetNull" — a soft delete doesn't
      // trigger the FK's DB-level onDelete: SetNull, so links referencing
      // this domain would otherwise dangle until a future join-time check.
      // This makes them fall back to the default LinkIQ URL immediately.
      await tx.link.updateMany({
        where: { customDomainId: domainId },
        data: { customDomainId: null },
      });
    });
    await this.cache.invalidate(existing.normalizedDomain);

    await this.audit.record({
      action: 'domain.deleted',
      entity: 'CustomDomain',
      entityId: domainId,
      userId,
      workspaceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }
}
