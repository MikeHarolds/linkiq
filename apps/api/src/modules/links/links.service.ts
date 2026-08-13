import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LinkStatus,
  WebhookEventType,
  type CustomDomain,
  type Link,
} from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { isUniqueConstraintViolation } from '../../common/utils/prisma-errors';
import {
  generateShortCode,
  validateCustomSlug,
} from '../../common/utils/short-code';
import { validateDestinationUrl } from '../../common/utils/url-validator';
import { AuditService } from '../audit/audit.service';
import { BillingUsageService } from '../billing/billing-usage.service';
import { validateUtmValues, type UtmValues } from '../campaigns/utils/utm';
import { DomainsService } from '../domains/domains.service';
import { PublicUrlService } from '../domains/public-url.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertCanUseOrEmitLimitReached } from '../webhooks/utils/assert-can-use-or-emit';
import { WebhookEventsService } from '../webhooks/webhook-events.service';

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

/** A Link enriched with its resolved custom domain and public URL — what
 * every LinksService method that returns a single link/list now returns.
 * Additive over the raw Prisma Link shape (shortCode etc. are untouched),
 * so existing clients that only read the old fields are unaffected. */
export type LinkWithPublicUrl = Link & {
  customDomain: CustomDomain | null;
  publicUrl: string;
};

const LINK_INCLUDE_CUSTOM_DOMAIN = { customDomain: true } as const;

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
    private readonly domains: DomainsService,
    private readonly publicUrlService: PublicUrlService,
    private readonly billingUsage: BillingUsageService,
    private readonly webhookEvents: WebhookEventsService,
  ) {}

  /** Validates a caller-supplied customDomainId (create/update): must
   * belong to this workspace and be VERIFIED/ACTIVE — throws 404/400 via
   * DomainsService.findSelectableOrThrow otherwise. */
  private async resolveCustomDomainId(
    workspaceId: string,
    customDomainId: string | null | undefined,
  ): Promise<void> {
    if (!customDomainId) return;
    await this.domains.findSelectableOrThrow(workspaceId, customDomainId);
  }

  private toResponse(
    link: Link & { customDomain: CustomDomain | null },
  ): LinkWithPublicUrl {
    return {
      ...link,
      publicUrl: this.publicUrlService.build(link.shortCode, link.customDomain),
    };
  }

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

  /**
   * Resolves the effective UTM values for a link being created or
   * updated: explicit fields on the DTO win; anything left unset falls
   * back to the campaign's defaults, if a campaign is given. Returns a
   * plain snapshot — see Link.utmSource et al. in schema.prisma for why
   * this is captured once here rather than re-resolved from the
   * campaign on every read.
   */
  private async resolveUtmFields(
    workspaceId: string,
    campaignId: string | undefined,
    dto: {
      utmSource?: string | null;
      utmMedium?: string | null;
      utmCampaign?: string | null;
      utmTerm?: string | null;
      utmContent?: string | null;
    },
  ): Promise<UtmValues> {
    let campaignDefaults: UtmValues = {};

    if (campaignId) {
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
      });
      if (
        !campaign ||
        campaign.deletedAt !== null ||
        campaign.workspaceId !== workspaceId
      ) {
        // Same "don't confirm existence in a workspace you can't see"
        // reasoning as everywhere else in the app.
        throw new NotFoundException('Campaign not found');
      }
      campaignDefaults = {
        utmSource: campaign.utmSource,
        utmMedium: campaign.utmMedium,
        utmCampaign: campaign.utmCampaign,
        utmTerm: campaign.utmTerm,
        utmContent: campaign.utmContent,
      };
    }

    // Deliberately `!== undefined`, not `??`: an explicit `null` (from
    // UpdateLinkDto, meaning "clear this field") must win outright and
    // never fall through to a campaign default, which `??` would do
    // incorrectly since it treats null and undefined as equally "unset".
    const pick = (
      explicit: string | null | undefined,
      fallback: string | null | undefined,
    ) =>
      explicit !== undefined
        ? (explicit ?? undefined)
        : (fallback ?? undefined);

    const resolved: UtmValues = {
      utmSource: pick(dto.utmSource, campaignDefaults.utmSource),
      utmMedium: pick(dto.utmMedium, campaignDefaults.utmMedium),
      utmCampaign: pick(dto.utmCampaign, campaignDefaults.utmCampaign),
      utmTerm: pick(dto.utmTerm, campaignDefaults.utmTerm),
      utmContent: pick(dto.utmContent, campaignDefaults.utmContent),
    };

    const validation = validateUtmValues(resolved);
    if (!validation.valid) {
      throw new BadRequestException(validation.reason ?? 'Invalid UTM values');
    }

    return resolved;
  }

  async create(
    workspaceId: string,
    userId: string,
    dto: CreateLinkDto,
    ctx: RequestContext,
  ): Promise<LinkWithPublicUrl> {
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

    await assertCanUseOrEmitLimitReached(
      this.billingUsage,
      this.webhookEvents,
      workspaceId,
      'MAX_LINKS',
      'links',
    );

    await this.resolveCustomDomainId(workspaceId, dto.customDomainId);

    const utm = await this.resolveUtmFields(workspaceId, dto.campaignId, dto);

    const link = dto.slug
      ? await this.createWithCustomSlug(
          workspaceId,
          userId,
          dto.slug,
          destinationUrl,
          dto,
          expiresAt,
          utm,
        )
      : await this.createWithGeneratedSlug(
          workspaceId,
          userId,
          destinationUrl,
          dto,
          expiresAt,
          utm,
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

    const response = this.toResponse(link);
    await this.webhookEvents.emit({
      type: WebhookEventType.LINK_CREATED,
      workspaceId,
      resourceId: link.id,
      data: {
        id: link.id,
        shortCode: link.shortCode,
        publicUrl: response.publicUrl,
        destinationUrl: link.destinationUrl,
        status: link.status,
        campaignId: link.campaignId,
        customDomainId: link.customDomainId,
      },
    });

    return response;
  }

  private async createWithCustomSlug(
    workspaceId: string,
    userId: string,
    slug: string,
    destinationUrl: string,
    dto: CreateLinkDto,
    expiresAt: Date | undefined,
    utm: UtmValues,
  ): Promise<Link & { customDomain: CustomDomain | null }> {
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
          campaignId: dto.campaignId,
          customDomainId: dto.customDomainId,
          ...utm,
        },
        include: LINK_INCLUDE_CUSTOM_DOMAIN,
      });
    } catch (error) {
      // The DB unique constraint on shortCode is the actual source of
      // truth for uniqueness — a prior findUnique-then-create check would
      // have a race window under concurrent requests for the same slug.
      // Prisma's unique-constraint violation (P2002) is what we rely on
      // instead — see common/utils/prisma-errors.ts.
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
    utm: UtmValues,
  ): Promise<Link & { customDomain: CustomDomain | null }> {
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
            campaignId: dto.campaignId,
            customDomainId: dto.customDomainId,
            ...utm,
          },
          include: LINK_INCLUDE_CUSTOM_DOMAIN,
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
  ): Promise<PaginatedResult<LinkWithPublicUrl>> {
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
        include: LINK_INCLUDE_CUSTOM_DOMAIN,
      }),
      this.prisma.link.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toResponse(item)),
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

  async findByIdOrThrow(
    workspaceId: string,
    linkId: string,
  ): Promise<LinkWithPublicUrl> {
    const link = await this.prisma.link.findUnique({
      where: { id: linkId },
      include: LINK_INCLUDE_CUSTOM_DOMAIN,
    });
    if (!link || link.deletedAt !== null) {
      throw new NotFoundException('Link not found');
    }
    if (link.workspaceId !== workspaceId) {
      // 404, not 403: confirming a link ID exists in a workspace the
      // caller can't see would itself leak information. Same principle
      // as workspace access checks elsewhere in the app.
      throw new NotFoundException('Link not found');
    }
    return this.toResponse(link);
  }

  async update(
    workspaceId: string,
    linkId: string,
    userId: string,
    dto: UpdateLinkDto,
    ctx: RequestContext,
  ): Promise<LinkWithPublicUrl> {
    const existing = await this.findByIdOrThrow(workspaceId, linkId);

    if (dto.customDomainId !== undefined) {
      await this.resolveCustomDomainId(workspaceId, dto.customDomainId);
    }

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
    if (dto.customDomainId !== undefined) {
      data.customDomainId = dto.customDomainId;
    }
    if (dto.expiresAt !== undefined) {
      const nextExpiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
      if (nextExpiresAt && nextExpiresAt.getTime() <= Date.now()) {
        throw new BadRequestException('expiresAt must be in the future');
      }
      data.expiresAt = nextExpiresAt;
    }

    if (dto.campaignId !== undefined) {
      // Reassigning (or clearing) the campaign is treated the same way
      // as at creation: any UTM field not explicitly set in THIS same
      // request inherits the new campaign's defaults (or clears to null,
      // if campaignId is being unset). Fields explicitly given always win.
      data.campaignId = dto.campaignId;
      const utm = await this.resolveUtmFields(
        workspaceId,
        dto.campaignId ?? undefined,
        dto,
      );
      Object.assign(data, utm);
    } else {
      // campaignId untouched — UTM fields (if any) are plain explicit
      // overrides, validated on their own; no campaign lookup needed.
      const explicitUtm = {
        utmSource: dto.utmSource,
        utmMedium: dto.utmMedium,
        utmCampaign: dto.utmCampaign,
        utmTerm: dto.utmTerm,
        utmContent: dto.utmContent,
      };
      const providedKeys = Object.entries(explicitUtm).filter(
        ([, v]) => v !== undefined,
      );
      if (providedKeys.length > 0) {
        const validation = validateUtmValues(Object.fromEntries(providedKeys));
        if (!validation.valid) {
          throw new BadRequestException(
            validation.reason ?? 'Invalid UTM values',
          );
        }
        for (const [key, value] of providedKeys) data[key] = value;
      }
    }

    const updated = await this.prisma.link.update({
      where: { id: linkId },
      data,
      include: LINK_INCLUDE_CUSTOM_DOMAIN,
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

    const response = this.toResponse(updated);
    await this.webhookEvents.emit({
      type: WebhookEventType.LINK_UPDATED,
      workspaceId,
      resourceId: linkId,
      data: {
        id: updated.id,
        shortCode: updated.shortCode,
        publicUrl: response.publicUrl,
        destinationUrl: updated.destinationUrl,
        status: updated.status,
        fields: Object.keys(dto),
      },
    });

    return response;
  }

  async transitionStatus(
    workspaceId: string,
    linkId: string,
    userId: string,
    nextStatus: LinkStatus,
    ctx: RequestContext,
  ): Promise<LinkWithPublicUrl> {
    const existing = await this.findByIdOrThrow(workspaceId, linkId);

    this.assertValidTransition(existing.status, nextStatus);

    const updated = await this.prisma.link.update({
      where: { id: linkId },
      data: { status: nextStatus, isActive: nextStatus === LinkStatus.ACTIVE },
      include: LINK_INCLUDE_CUSTOM_DOMAIN,
    });
    await this.cache.invalidate(existing.shortCode);

    const actionByStatus: Record<LinkStatus, string> = {
      [LinkStatus.ACTIVE]: 'link.activated',
      [LinkStatus.PAUSED]: 'link.paused',
      [LinkStatus.ARCHIVED]: 'link.archived',
    };
    const eventByStatus: Record<LinkStatus, WebhookEventType> = {
      [LinkStatus.ACTIVE]: WebhookEventType.LINK_ACTIVATED,
      [LinkStatus.PAUSED]: WebhookEventType.LINK_PAUSED,
      [LinkStatus.ARCHIVED]: WebhookEventType.LINK_ARCHIVED,
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

    await this.webhookEvents.emit({
      type: eventByStatus[nextStatus],
      workspaceId,
      resourceId: linkId,
      data: {
        id: updated.id,
        shortCode: updated.shortCode,
        previousStatus: existing.status,
        status: updated.status,
      },
    });

    return this.toResponse(updated);
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

    await this.webhookEvents.emit({
      type: WebhookEventType.LINK_DELETED,
      workspaceId,
      resourceId: linkId,
      data: { id: linkId, shortCode: existing.shortCode },
    });
  }
}
