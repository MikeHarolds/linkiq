import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WebhookEventType, type LinkSource } from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { isUniqueConstraintViolation } from '../../common/utils/prisma-errors';
import { AuditService } from '../audit/audit.service';
import { PublicUrlService } from '../domains/public-url.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookEventsService } from '../webhooks/webhook-events.service';

import type { CreateLinkSourceDto } from './dto/create-link-source.dto';
import type { UpdateLinkSourceDto } from './dto/update-link-source.dto';
import { normalizeSourceKey } from './utils/normalize-source-key';

/**
 * Explicit Link Source / Campaign Attribution — see LinkSource in
 * schema.prisma for the full rationale. This service owns the
 * CRUD/lifecycle side (create/list/update/deactivate/delete); the
 * actual click-time resolution that makes a matched source "win" over
 * UTM/Referer/Direct lives in
 * analytics/processors/click-event.processor.ts, which reads this same
 * table directly rather than going through this service (it's an async
 * background worker, not a request handler).
 */
@Injectable()
export class LinkSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly publicUrl: PublicUrlService,
    private readonly webhookEvents: WebhookEventsService,
  ) {}

  /** The tracking URL a user copies/shares — same shortCode/destination
   * as the base link, distinguished only by these UTM params. Mirrors
   * QrCodesService.buildEncodedUrl's approach: reuse PublicUrlService
   * (the single source of truth for a link's resolved public URL,
   * custom-domain-aware) rather than re-deriving it. */
  private buildTrackingUrl(
    shortCode: string,
    customDomain: Parameters<PublicUrlService['build']>[1],
    source: string,
    medium: string,
    campaign: string | null,
  ): string {
    const url = new URL(this.publicUrl.build(shortCode, customDomain));
    url.searchParams.set('utm_source', source);
    url.searchParams.set('utm_medium', medium);
    if (campaign) url.searchParams.set('utm_campaign', campaign);
    return url.toString();
  }

  private async findLinkOrThrow(workspaceId: string, linkId: string) {
    const link = await this.prisma.link.findUnique({ where: { id: linkId } });
    if (!link || link.deletedAt !== null || link.workspaceId !== workspaceId) {
      // 404, not 403 — same reasoning as LinksService/QrCodesService:
      // confirming a link ID exists in a workspace the caller can't see
      // would itself leak information.
      throw new NotFoundException('Link not found');
    }
    return link;
  }

  async findByIdOrThrow(
    workspaceId: string,
    id: string,
  ): Promise<LinkSource> {
    const source = await this.prisma.linkSource.findUnique({
      where: { id },
    });
    if (
      !source ||
      source.deletedAt !== null ||
      source.workspaceId !== workspaceId
    ) {
      throw new NotFoundException('Tracking source not found');
    }
    return source;
  }

  async create(
    workspaceId: string,
    linkId: string,
    userId: string,
    dto: CreateLinkSourceDto,
    ctx: RequestContext,
  ): Promise<LinkSource & { trackingUrl: string }> {
    const link = await this.findLinkOrThrow(workspaceId, linkId);
    const customDomain = link.customDomainId
      ? await this.prisma.customDomain.findUnique({
          where: { id: link.customDomainId },
        })
      : null;

    const source = normalizeSourceKey(dto.source);

    let created: LinkSource;
    try {
      created = await this.prisma.linkSource.create({
        data: {
          workspaceId,
          linkId,
          createdById: userId,
          name: dto.name,
          source,
          medium: dto.medium,
          campaign: dto.campaign,
        },
      });
    } catch (error) {
      // link_sources_linkId_source_key (partial unique, WHERE deletedAt
      // IS NULL) is the real source of truth for "one active source per
      // (link, source)" — a prior findFirst-then-create check would have
      // a race window under concurrent requests, same reasoning as
      // campaign name uniqueness.
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          'This link already has a tracking source with this source key',
        );
      }
      throw error;
    }

    await this.audit.record({
      action: 'link_source.created',
      entity: 'LinkSource',
      entityId: created.id,
      userId,
      workspaceId,
      metadata: { linkId, name: created.name, source: created.source },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.webhookEvents.emit({
      type: WebhookEventType.LINK_SOURCE_CREATED,
      workspaceId,
      resourceId: created.id,
      data: {
        id: created.id,
        linkId,
        name: created.name,
        source: created.source,
        medium: created.medium,
      },
    });

    return {
      ...created,
      trackingUrl: this.buildTrackingUrl(
        link.shortCode,
        customDomain,
        created.source,
        created.medium,
        created.campaign,
      ),
    };
  }

  async findAllForLink(
    workspaceId: string,
    linkId: string,
  ): Promise<(LinkSource & { trackingUrl: string; clickCount: number })[]> {
    const link = await this.findLinkOrThrow(workspaceId, linkId);
    const customDomain = link.customDomainId
      ? await this.prisma.customDomain.findUnique({
          where: { id: link.customDomainId },
        })
      : null;

    const sources = await this.prisma.linkSource.findMany({
      where: { workspaceId, linkId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const counts = await this.prisma.clickEvent.groupBy({
      by: ['linkSourceId'],
      where: {
        linkId,
        linkSourceId: { in: sources.map((s) => s.id) },
      },
      _count: { _all: true },
    });
    const countBySourceId = new Map(
      counts.map((c) => [c.linkSourceId, c._count._all]),
    );

    return sources.map((s) => ({
      ...s,
      trackingUrl: this.buildTrackingUrl(
        link.shortCode,
        customDomain,
        s.source,
        s.medium,
        s.campaign,
      ),
      clickCount: countBySourceId.get(s.id) ?? 0,
    }));
  }

  async update(
    workspaceId: string,
    id: string,
    userId: string,
    dto: UpdateLinkSourceDto,
    ctx: RequestContext,
  ): Promise<LinkSource> {
    await this.findByIdOrThrow(workspaceId, id);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.source !== undefined) data.source = normalizeSourceKey(dto.source);
    if (dto.medium !== undefined) data.medium = dto.medium;
    if (dto.campaign !== undefined) data.campaign = dto.campaign;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    let updated: LinkSource;
    try {
      updated = await this.prisma.linkSource.update({
        where: { id },
        data,
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          'This link already has a tracking source with this source key',
        );
      }
      throw error;
    }

    await this.audit.record({
      action: 'link_source.updated',
      entity: 'LinkSource',
      entityId: id,
      userId,
      workspaceId,
      metadata: { fields: Object.keys(data) },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.webhookEvents.emit({
      type: WebhookEventType.LINK_SOURCE_UPDATED,
      workspaceId,
      resourceId: id,
      data: { id: updated.id, name: updated.name, fields: Object.keys(data) },
    });

    return updated;
  }

  async softDelete(
    workspaceId: string,
    id: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await this.findByIdOrThrow(workspaceId, id);

    // Soft delete only — historical ClickEvent rows already carry their
    // own denormalized attributedSource/Medium/Campaign snapshot (see
    // ClickEvent in schema.prisma), so they stay fully accurate and
    // queryable regardless of what happens to this row afterward.
    await this.prisma.linkSource.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      action: 'link_source.deleted',
      entity: 'LinkSource',
      entityId: id,
      userId,
      workspaceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.webhookEvents.emit({
      type: WebhookEventType.LINK_SOURCE_DELETED,
      workspaceId,
      resourceId: id,
      data: { id },
    });
  }
}
