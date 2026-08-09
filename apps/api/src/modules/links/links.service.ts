import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LinkStatus, type Link } from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import {
  generateShortCode,
  validateCustomSlug,
} from '../../common/utils/short-code';
import { validateDestinationUrl } from '../../common/utils/url-validator';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import type { CreateLinkDto } from './dto/create-link.dto';
import type { QueryLinksDto } from './dto/query-links.dto';
import type { UpdateLinkDto } from './dto/update-link.dto';
import { LinkCacheService } from './link-cache.service';

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

/** How many times to retry auto-generated short codes on a collision
 * before giving up. Collision probability at 7 base62 chars is low enough
 * that hitting this ceiling would itself indicate a deeper problem. */
const MAX_AUTO_CODE_ATTEMPTS = 5;

@Injectable()
export class LinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cache: LinkCacheService,
  ) {}

  /**
   * True "expired" status as observed by callers — derived from
   * `expiresAt` rather than trusting the stored `status`, so a link is
   * reported as expired the instant its clock passes, without depending
   * on a background job having already run. See schema.prisma's comment
   * on LinkStatus for the full rationale.
   */
  isEffectivelyExpired(link: Pick<Link, 'expiresAt' | 'status'>): boolean {
    return (
      link.status === LinkStatus.ACTIVE &&
      link.expiresAt !== null &&
      link.expiresAt.getTime() < Date.now()
    );
  }

  async create(
    workspaceId: string,
    userId: string,
    dto: CreateLinkDto,
    ctx: RequestContext,
  ): Promise<Link> {
    const urlResult = validateDestinationUrl(dto.destinationUrl);
    if (!urlResult.valid) {
      throw new BadRequestException(
        urlResult.reason ?? 'Invalid destination URL',
      );
    }
    const destinationUrl = urlResult.normalized!;

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be in the future');
    }

    const link = dto.slug
      ? await this.createWithCustomSlug(
          workspaceId,
          userId,
          dto.slug,
          destinationUrl,
          dto,
          expiresAt,
        )
      : await this.createWithGeneratedSlug(
          workspaceId,
          userId,
          destinationUrl,
          dto,
          expiresAt,
        );

    await this.audit.record({
      action: 'link.created',
      entity: 'Link',
      entityId: link.id,
      userId,
      workspaceId,
      metadata: { shortCode: link.shortCode },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return link;
  }

  private async createWithCustomSlug(
    workspaceId: string,
    userId: string,
    slug: string,
    destinationUrl: string,
    dto: CreateLinkDto,
    expiresAt: Date | undefined,
  ): Promise<Link> {
    const slugResult = validateCustomSlug(slug);
    if (!slugResult.valid) {
      throw new BadRequestException(slugResult.reason ?? 'Invalid slug');
    }

    try {
      return await this.prisma.link.create({
        data: {
          workspaceId,
          createdById: userId,
          destinationUrl,
          shortCode: slug,
          title: dto.title,
          description: dto.description,
          expiresAt,
        },
      });
    } catch (error) {
      // The DB unique constraint on shortCode is the actual source of
      // truth for uniqueness — a prior findUnique-then-create check would
      // have a race window under concurrent requests for the same slug.
      // Postgres's unique_violation (23505) is what we rely on instead.
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException('This slug is already in use');
      }
      throw error;
    }
  }

  private async createWithGeneratedSlug(
    workspaceId: string,
    userId: string,
    destinationUrl: string,
    dto: CreateLinkDto,
    expiresAt: Date | undefined,
  ): Promise<Link> {
    for (let attempt = 0; attempt < MAX_AUTO_CODE_ATTEMPTS; attempt++) {
      const shortCode = generateShortCode();
      try {
        return await this.prisma.link.create({
          data: {
            workspaceId,
            createdById: userId,
            destinationUrl,
            shortCode,
            title: dto.title,
            description: dto.description,
            expiresAt,
          },
        });
      } catch (error) {
        if (isUniqueConstraintViolation(error)) {
          continue; // extremely unlikely at 7 base62 chars, but retry rather than fail
        }
        throw error;
      }
    }
    throw new ConflictException(
      'Could not generate a unique short code — please try again',
    );
  }

  async findAll(
    workspaceId: string,
    query: QueryLinksDto,
  ): Promise<PaginatedResult<Link>> {
    const searchTerm = query.search?.trim();

    const where: Record<string, unknown> = {
      workspaceId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(searchTerm
        ? {
            OR: [
              { title: { contains: searchTerm, mode: 'insensitive' } },
              { shortCode: { contains: searchTerm, mode: 'insensitive' } },
              { destinationUrl: { contains: searchTerm, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.createdAfter || query.createdBefore
        ? {
            createdAt: {
              ...(query.createdAfter
                ? { gte: new Date(query.createdAfter) }
                : {}),
              ...(query.createdBefore
                ? { lte: new Date(query.createdBefore) }
                : {}),
            },
          }
        : {}),
    };

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [items, totalItems] = await Promise.all([
      this.prisma.link.findMany({
        where,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.link.count({ where }),
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

  /** Structural (non-click) dashboard counts — see LinksController for the
   * explicit "not click analytics" framing this backs. */
  async getWorkspaceStats(workspaceId: string) {
    const [total, active, paused, archived, recent] = await Promise.all([
      this.prisma.link.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.link.count({
        where: { workspaceId, deletedAt: null, status: LinkStatus.ACTIVE },
      }),
      this.prisma.link.count({
        where: { workspaceId, deletedAt: null, status: LinkStatus.PAUSED },
      }),
      this.prisma.link.count({
        where: { workspaceId, deletedAt: null, status: LinkStatus.ARCHIVED },
      }),
      this.prisma.link.findMany({
        where: { workspaceId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    // Expired is derived, not stored — count ACTIVE links whose expiresAt
    // has already passed rather than relying on a stored status value.
    const activeLinks = await this.prisma.link.findMany({
      where: { workspaceId, deletedAt: null, status: LinkStatus.ACTIVE },
      select: { expiresAt: true },
    });
    const expired = activeLinks.filter(
      (l: { expiresAt: Date | null }) =>
        l.expiresAt !== null && l.expiresAt.getTime() < Date.now(),
    ).length;

    return {
      totalLinks: total,
      activeLinks: active - expired,
      pausedLinks: paused,
      expiredLinks: expired,
      archivedLinks: archived,
      recentLinks: recent,
    };
  }

  async findByIdOrThrow(workspaceId: string, linkId: string): Promise<Link> {
    const link = await this.prisma.link.findUnique({ where: { id: linkId } });
    if (!link || link.deletedAt !== null) {
      throw new NotFoundException('Link not found');
    }
    if (link.workspaceId !== workspaceId) {
      // 404, not 403: confirming a link ID exists in a workspace the
      // caller can't see would itself leak information. Same principle
      // as workspace access checks elsewhere in the app.
      throw new NotFoundException('Link not found');
    }
    return link;
  }

  async update(
    workspaceId: string,
    linkId: string,
    userId: string,
    dto: UpdateLinkDto,
    ctx: RequestContext,
  ): Promise<Link> {
    const existing = await this.findByIdOrThrow(workspaceId, linkId);

    const data: Record<string, unknown> = {};

    if (dto.destinationUrl !== undefined) {
      const urlResult = validateDestinationUrl(dto.destinationUrl);
      if (!urlResult.valid) {
        throw new BadRequestException(
          urlResult.reason ?? 'Invalid destination URL',
        );
      }
      data.destinationUrl = urlResult.normalized!;
    }
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.expiresAt !== undefined) {
      const nextExpiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
      if (nextExpiresAt && nextExpiresAt.getTime() <= Date.now()) {
        throw new BadRequestException('expiresAt must be in the future');
      }
      data.expiresAt = nextExpiresAt;
    }

    const updated = await this.prisma.link.update({
      where: { id: linkId },
      data,
    });
    await this.cache.invalidate(existing.shortCode);

    await this.audit.record({
      action: 'link.updated',
      entity: 'Link',
      entityId: linkId,
      userId,
      workspaceId,
      metadata: { fields: Object.keys(dto) },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  async transitionStatus(
    workspaceId: string,
    linkId: string,
    userId: string,
    nextStatus: LinkStatus,
    ctx: RequestContext,
  ): Promise<Link> {
    const existing = await this.findByIdOrThrow(workspaceId, linkId);

    this.assertValidTransition(existing.status, nextStatus);

    const updated = await this.prisma.link.update({
      where: { id: linkId },
      data: { status: nextStatus, isActive: nextStatus === LinkStatus.ACTIVE },
    });
    await this.cache.invalidate(existing.shortCode);

    const actionByStatus: Record<LinkStatus, string> = {
      [LinkStatus.ACTIVE]: 'link.activated',
      [LinkStatus.PAUSED]: 'link.paused',
      [LinkStatus.ARCHIVED]: 'link.archived',
    };

    await this.audit.record({
      action: actionByStatus[nextStatus],
      entity: 'Link',
      entityId: linkId,
      userId,
      workspaceId,
      metadata: { previousStatus: existing.status, newStatus: nextStatus },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  /** Reactivating a link is only meaningful from PAUSED or ARCHIVED — not
   * every status transition makes sense (e.g. ACTIVE -> ACTIVE is a no-op
   * the caller shouldn't need, and there's no path back from a hard delete). */
  private assertValidTransition(current: LinkStatus, next: LinkStatus): void {
    if (current === next) {
      throw new BadRequestException(`Link is already ${next.toLowerCase()}`);
    }
  }

  async softDelete(
    workspaceId: string,
    linkId: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const existing = await this.findByIdOrThrow(workspaceId, linkId);

    await this.prisma.link.update({
      where: { id: linkId },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.cache.invalidate(existing.shortCode);

    await this.audit.record({
      action: 'link.deleted',
      entity: 'Link',
      entityId: linkId,
      userId,
      workspaceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }
}

/** Prisma (and this codebase's local test shim) both surface Postgres's
 * unique_violation as an error carrying code '23505' — check for it
 * generically rather than importing Prisma's error class, which the shim
 * doesn't replicate. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
