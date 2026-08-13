import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CampaignStatus, WebhookEventType, type Campaign } from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { isUniqueConstraintViolation } from '../../common/utils/prisma-errors';
import { AuditService } from '../audit/audit.service';
import { BillingUsageService } from '../billing/billing-usage.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertCanUseOrEmitLimitReached } from '../webhooks/utils/assert-can-use-or-emit';
import { WebhookEventsService } from '../webhooks/webhook-events.service';

import type { CreateCampaignDto } from './dto/create-campaign.dto';
import type { QueryCampaignsDto } from './dto/query-campaigns.dto';
import type { UpdateCampaignDto } from './dto/update-campaign.dto';
import { validateUtmValues } from './utils/utm';

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

/** Valid forward transitions. DRAFT/ACTIVE/PAUSED can all move to
 * ARCHIVED at any time (an operator abandoning a campaign early is
 * normal); COMPLETED is reached automatically by end date passing, not
 * via an explicit action, so it's not part of this transition table —
 * see getEffectiveStatus. */
const VALID_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: [CampaignStatus.ACTIVE, CampaignStatus.ARCHIVED],
  ACTIVE: [CampaignStatus.PAUSED, CampaignStatus.ARCHIVED],
  PAUSED: [CampaignStatus.ACTIVE, CampaignStatus.ARCHIVED],
  COMPLETED: [CampaignStatus.ARCHIVED],
  ARCHIVED: [],
};

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly billingUsage: BillingUsageService,
    private readonly webhookEvents: WebhookEventsService,
  ) {}

  /**
   * A campaign whose endDate has passed is reported as effectively
   * COMPLETED regardless of its stored status — the same derived-state
   * pattern already used for link expiry (see LinksService.isEffectivelyExpired
   * and schema.prisma's comment on LinkStatus for the full rationale: no
   * background job needs to run for this to be correct). Only applies to
   * ACTIVE/PAUSED campaigns — a DRAFT campaign with a past end date was
   * never launched, and an ARCHIVED one stays archived.
   */
  getEffectiveStatus(
    campaign: Pick<Campaign, 'status' | 'endDate'>,
  ): CampaignStatus {
    const isRunning =
      campaign.status === CampaignStatus.ACTIVE ||
      campaign.status === CampaignStatus.PAUSED;
    if (
      isRunning &&
      campaign.endDate &&
      campaign.endDate.getTime() < Date.now()
    ) {
      return CampaignStatus.COMPLETED;
    }
    return campaign.status;
  }

  private validateDateRange(startDate?: string, endDate?: string): void {
    if (
      startDate &&
      endDate &&
      new Date(endDate).getTime() < new Date(startDate).getTime()
    ) {
      throw new BadRequestException('endDate cannot be earlier than startDate');
    }
  }

  async create(
    workspaceId: string,
    userId: string,
    dto: CreateCampaignDto,
    ctx: RequestContext,
  ): Promise<Campaign> {
    this.validateDateRange(dto.startDate, dto.endDate);

    const utmValidation = validateUtmValues(dto);
    if (!utmValidation.valid) {
      throw new BadRequestException(
        utmValidation.reason ?? 'Invalid UTM values',
      );
    }

    await assertCanUseOrEmitLimitReached(
      this.billingUsage,
      this.webhookEvents,
      workspaceId,
      'MAX_CAMPAIGNS',
      'campaigns',
    );

    try {
      const campaign = await this.prisma.campaign.create({
        data: {
          workspaceId,
          createdById: userId,
          name: dto.name,
          description: dto.description,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          utmSource: dto.utmSource,
          utmMedium: dto.utmMedium,
          utmCampaign: dto.utmCampaign,
          utmTerm: dto.utmTerm,
          utmContent: dto.utmContent,
        },
      });

      await this.audit.record({
        action: 'campaign.created',
        entity: 'Campaign',
        entityId: campaign.id,
        userId,
        workspaceId,
        metadata: { name: campaign.name },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      await this.webhookEvents.emit({
        type: WebhookEventType.CAMPAIGN_CREATED,
        workspaceId,
        resourceId: campaign.id,
        data: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          startDate: campaign.startDate,
          endDate: campaign.endDate,
        },
      });

      return campaign;
    } catch (error) {
      // The DB's partial unique index (workspaceId, name) WHERE deletedAt
      // IS NULL is the real source of truth — a prior findFirst-then-create
      // check would have a race window under concurrent requests for the
      // same name, same reasoning as link shortCode uniqueness.
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          'A campaign with this name already exists in this workspace',
        );
      }
      throw error;
    }
  }

  async findAll(
    workspaceId: string,
    query: QueryCampaignsDto,
  ): Promise<PaginatedResult<Campaign & { linkCount: number }>> {
    const searchTerm = query.search?.trim();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Record<string, unknown> = {
      workspaceId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(searchTerm
        ? {
            OR: [
              { name: { contains: searchTerm, mode: 'insensitive' } },
              { description: { contains: searchTerm, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.startsAfter
        ? { startDate: { gte: new Date(query.startsAfter) } }
        : {}),
      ...(query.endsBefore
        ? { endDate: { lte: new Date(query.endsBefore) } }
        : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.campaign.count({ where }),
    ]);

    // One aggregate query for link counts across all returned campaigns,
    // not N+1 — see docs/architecture/campaigns.md's performance section.
    const campaignIds = items.map((c: Campaign) => c.id);
    const linkCounts =
      campaignIds.length > 0
        ? await this.prisma.$queryRawUnsafe<
            Array<{ campaignId: string; count: number }>
          >(
            `SELECT "campaignId", count(*)::int AS count
             FROM links
             WHERE "campaignId" = ANY($1::uuid[]) AND "deletedAt" IS NULL
             GROUP BY "campaignId"`,
            campaignIds,
          )
        : [];
    const countByCampaign = new Map(
      linkCounts.map((row) => [row.campaignId, row.count]),
    );

    return {
      items: items.map((campaign: Campaign) => ({
        ...campaign,
        linkCount: countByCampaign.get(campaign.id) ?? 0,
      })),
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
    campaignId: string,
  ): Promise<Campaign> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (
      !campaign ||
      campaign.deletedAt !== null ||
      campaign.workspaceId !== workspaceId
    ) {
      throw new NotFoundException('Campaign not found');
    }
    return campaign;
  }

  async update(
    workspaceId: string,
    campaignId: string,
    userId: string,
    dto: UpdateCampaignDto,
    ctx: RequestContext,
  ): Promise<Campaign> {
    const existing = await this.findByIdOrThrow(workspaceId, campaignId);

    const effectiveStart = dto.startDate ?? existing.startDate?.toISOString();
    const effectiveEnd = dto.endDate ?? existing.endDate?.toISOString();
    this.validateDateRange(effectiveStart, effectiveEnd);

    const utmValidation = validateUtmValues(dto);
    if (!utmValidation.valid) {
      throw new BadRequestException(
        utmValidation.reason ?? 'Invalid UTM values',
      );
    }

    const data: Record<string, unknown> = {};
    for (const key of [
      'name',
      'description',
      'utmSource',
      'utmMedium',
      'utmCampaign',
      'utmTerm',
      'utmContent',
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);

    let updated: Campaign;
    try {
      updated = await this.prisma.campaign.update({
        where: { id: campaignId },
        data,
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          'A campaign with this name already exists in this workspace',
        );
      }
      throw error;
    }

    const utmFieldsChanged = [
      'utmSource',
      'utmMedium',
      'utmCampaign',
      'utmTerm',
      'utmContent',
    ].some((key) => key in data);

    await this.audit.record({
      action: utmFieldsChanged ? 'campaign.utm_updated' : 'campaign.updated',
      entity: 'Campaign',
      entityId: campaignId,
      userId,
      workspaceId,
      metadata: { fields: Object.keys(data) },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.webhookEvents.emit({
      type: WebhookEventType.CAMPAIGN_UPDATED,
      workspaceId,
      resourceId: campaignId,
      data: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        fields: Object.keys(data),
      },
    });

    return updated;
  }

  async transitionStatus(
    workspaceId: string,
    campaignId: string,
    userId: string,
    nextStatus: CampaignStatus,
    ctx: RequestContext,
  ): Promise<Campaign> {
    const existing = await this.findByIdOrThrow(workspaceId, campaignId);

    const allowed = VALID_TRANSITIONS[existing.status];
    if (!allowed.includes(nextStatus)) {
      throw new BadRequestException(
        `Cannot transition campaign from ${existing.status} to ${nextStatus}`,
      );
    }

    const updated = await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: nextStatus },
    });

    const actionByStatus: Partial<Record<CampaignStatus, string>> = {
      [CampaignStatus.ACTIVE]: 'campaign.activated',
      [CampaignStatus.PAUSED]: 'campaign.paused',
      [CampaignStatus.ARCHIVED]: 'campaign.archived',
    };
    const eventByStatus: Partial<Record<CampaignStatus, WebhookEventType>> = {
      [CampaignStatus.ACTIVE]: WebhookEventType.CAMPAIGN_ACTIVATED,
      [CampaignStatus.PAUSED]: WebhookEventType.CAMPAIGN_PAUSED,
      [CampaignStatus.ARCHIVED]: WebhookEventType.CAMPAIGN_ARCHIVED,
    };

    await this.audit.record({
      action: actionByStatus[nextStatus] ?? 'campaign.updated',
      entity: 'Campaign',
      entityId: campaignId,
      userId,
      workspaceId,
      metadata: { previousStatus: existing.status, newStatus: nextStatus },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    const webhookEventType = eventByStatus[nextStatus];
    if (webhookEventType) {
      await this.webhookEvents.emit({
        type: webhookEventType,
        workspaceId,
        resourceId: campaignId,
        data: {
          id: updated.id,
          name: updated.name,
          previousStatus: existing.status,
          status: updated.status,
        },
      });
    }

    return updated;
  }

  /** Links keep working exactly as before — this only marks the campaign
   * record itself deleted. See Link.campaign (onDelete: SetNull) and
   * docs/architecture/campaigns.md: no cascading delete of links, ever. */
  async softDelete(
    workspaceId: string,
    campaignId: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await this.findByIdOrThrow(workspaceId, campaignId);

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      action: 'campaign.deleted',
      entity: 'Campaign',
      entityId: campaignId,
      userId,
      workspaceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.webhookEvents.emit({
      type: WebhookEventType.CAMPAIGN_DELETED,
      workspaceId,
      resourceId: campaignId,
      data: { id: campaignId },
    });
  }

  /** Links currently assigned to a campaign — used by the campaign
   * detail page. Soft-deleted links are excluded, matching every other
   * link listing in the app. QR codes are fetched in one extra query
   * (not per-link) and attached in application code — a has-many
   * "include" the other way from every other relation this codebase's
   * data layer has needed so far. */
  async findLinksForCampaign(workspaceId: string, campaignId: string) {
    await this.findByIdOrThrow(workspaceId, campaignId);

    const links = await this.prisma.link.findMany({
      where: { workspaceId, campaignId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (links.length === 0) return [];

    const linkIds = links.map((link: { id: string }) => link.id);
    const qrCodes = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; linkId: string; name: string; format: string }>
    >(
      `SELECT id, "linkId", name, format FROM qr_codes
       WHERE "linkId" = ANY($1::uuid[]) AND "deletedAt" IS NULL
       ORDER BY "createdAt" DESC`,
      linkIds,
    );
    const qrCodesByLink = new Map<string, typeof qrCodes>();
    for (const qr of qrCodes) {
      const existing = qrCodesByLink.get(qr.linkId) ?? [];
      existing.push(qr);
      qrCodesByLink.set(qr.linkId, existing);
    }

    return links.map((link: { id: string }) => ({
      ...link,
      qrCodes: qrCodesByLink.get(link.id) ?? [],
    }));
  }
}
