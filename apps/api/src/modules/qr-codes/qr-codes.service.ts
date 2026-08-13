import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QrFormat, WebhookEventType, type QrCode } from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { slugify } from '../../common/utils/slugify';
import { AuditService } from '../audit/audit.service';
import { BillingUsageService } from '../billing/billing-usage.service';
import { PublicUrlService } from '../domains/public-url.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertCanUseOrEmitLimitReached } from '../webhooks/utils/assert-can-use-or-emit';
import { WebhookEventsService } from '../webhooks/webhook-events.service';

import type { CreateQrCodeDto } from './dto/create-qr-code.dto';
import type { UpdateQrCodeDto } from './dto/update-qr-code.dto';
import { QrGeneratorService } from './qr-generator.service';
import { validateQrConfig } from './utils/qr-validation';

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface QrDownload {
  data: Buffer | string;
  contentType: string;
  filename: string;
}

/** Must stay in sync with the @default(...) values in schema.prisma's
 * QrCode model — duplicated here because effective-config validation
 * (see `create` and `update` below) needs to know what a field defaults
 * to even when the caller omits it, and there's no clean way to read a
 * Prisma schema default back out at runtime. */
const QR_DEFAULTS = {
  size: 512,
  margin: 4,
  foregroundColor: '#000000',
  backgroundColor: '#FFFFFF',
};

@Injectable()
export class QrCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly generator: QrGeneratorService,
    private readonly publicUrl: PublicUrlService,
    private readonly billingUsage: BillingUsageService,
    private readonly webhookEvents: WebhookEventsService,
  ) {}

  /**
   * The exact string every QR code encodes: the link's resolved public
   * URL (its active custom domain, if any — Sprint 6 — else the default
   * LinkIQ short URL, via PublicUrlService, the single source of truth
   * for that resolution shared with LinksService), plus a fixed set of
   * UTM parameters identifying the traffic as QR-originated.
   *
   * This is the whole of Sprint 4's "QR attribution" mechanism — see
   * docs/architecture/qr-codes.md for the full rationale. In short: the
   * existing redirect and analytics pipeline (Sprint 2/3) already parses
   * and stores utm_source/utm_medium/utm_campaign from the query string
   * on every redirect, with zero special-casing. Encoding these params
   * into the QR image itself means QR-originated scans are distinguishable
   * in analytics through the *existing* mechanism — no new ClickEvent
   * column, no redirect-path branching, no performance cost, and no
   * second analytics pipeline.
   */
  private buildEncodedUrl(
    shortCode: string,
    qrName: string,
    customDomain: Parameters<PublicUrlService['build']>[1],
  ): string {
    const url = new URL(this.publicUrl.build(shortCode, customDomain));
    url.searchParams.set('utm_source', 'qr_code');
    url.searchParams.set('utm_medium', 'qr');
    url.searchParams.set('utm_campaign', slugify(qrName) || 'qr-code');
    return url.toString();
  }

  private async findLinkOrThrow(workspaceId: string, linkId: string) {
    const link = await this.prisma.link.findUnique({ where: { id: linkId } });
    if (!link || link.deletedAt !== null || link.workspaceId !== workspaceId) {
      // 404, not 403 — same reasoning as LinksService: confirming a link
      // ID exists in a workspace the caller can't see would itself leak
      // information.
      throw new NotFoundException('Link not found');
    }
    return link;
  }

  async create(
    workspaceId: string,
    linkId: string,
    userId: string,
    dto: CreateQrCodeDto,
    ctx: RequestContext,
  ): Promise<QrCode> {
    await this.findLinkOrThrow(workspaceId, linkId);
    await assertCanUseOrEmitLimitReached(
      this.billingUsage,
      this.webhookEvents,
      workspaceId,
      'MAX_QR_CODES',
      'QR codes',
    );

    // Validate the EFFECTIVE config (explicit values merged with the same
    // defaults schema.prisma/the migration apply) — not just whatever the
    // caller happened to send. Without this, an invalid-but-omittable
    // combination (most importantly: identical fg/bg colors, which no
    // single-field check can catch) would only ever be caught later, at
    // download time, after already being persisted.
    const effective = {
      size: dto.size ?? QR_DEFAULTS.size,
      margin: dto.margin ?? QR_DEFAULTS.margin,
      foregroundColor: dto.foregroundColor ?? QR_DEFAULTS.foregroundColor,
      backgroundColor: dto.backgroundColor ?? QR_DEFAULTS.backgroundColor,
    };
    const validation = validateQrConfig(effective);
    if (!validation.valid) {
      throw new BadRequestException(
        validation.reason ?? 'Invalid QR configuration',
      );
    }

    const qrCode = await this.prisma.qrCode.create({
      data: {
        workspaceId,
        linkId,
        createdById: userId,
        name: dto.name,
        format: dto.format,
        size: dto.size,
        foregroundColor: dto.foregroundColor,
        backgroundColor: dto.backgroundColor,
        errorCorrectionLevel: dto.errorCorrectionLevel,
        margin: dto.margin,
      },
    });

    await this.audit.record({
      action: 'qr_code.created',
      entity: 'QrCode',
      entityId: qrCode.id,
      userId,
      workspaceId,
      metadata: { linkId, name: qrCode.name },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.webhookEvents.emit({
      type: WebhookEventType.QRCODE_CREATED,
      workspaceId,
      resourceId: qrCode.id,
      data: {
        id: qrCode.id,
        linkId,
        name: qrCode.name,
        format: qrCode.format,
      },
    });

    return qrCode;
  }

  async findAllForLink(workspaceId: string, linkId: string): Promise<QrCode[]> {
    await this.findLinkOrThrow(workspaceId, linkId);
    return this.prisma.qrCode.findMany({
      where: { workspaceId, linkId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllForWorkspace(
    workspaceId: string,
    params: {
      page?: number;
      pageSize?: number;
      search?: string;
      linkId?: string;
    },
  ): Promise<PaginatedResult<QrCode>> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const searchTerm = params.search?.trim();

    const where: Record<string, unknown> = {
      workspaceId,
      deletedAt: null,
      ...(params.linkId ? { linkId: params.linkId } : {}),
      ...(searchTerm
        ? { name: { contains: searchTerm, mode: 'insensitive' } }
        : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.qrCode.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { link: true },
      }),
      this.prisma.qrCode.count({ where }),
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

  async findByIdOrThrow(workspaceId: string, qrId: string): Promise<QrCode> {
    const qrCode = await this.prisma.qrCode.findUnique({ where: { id: qrId } });
    if (
      !qrCode ||
      qrCode.deletedAt !== null ||
      qrCode.workspaceId !== workspaceId
    ) {
      throw new NotFoundException('QR code not found');
    }
    return qrCode;
  }

  async update(
    workspaceId: string,
    qrId: string,
    userId: string,
    dto: UpdateQrCodeDto,
    ctx: RequestContext,
  ): Promise<QrCode> {
    const existing = await this.findByIdOrThrow(workspaceId, qrId);

    const data: Record<string, unknown> = {};
    for (const key of [
      'name',
      'format',
      'size',
      'foregroundColor',
      'backgroundColor',
      'errorCorrectionLevel',
      'margin',
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }

    // Same reasoning as create(): validate the EFFECTIVE config (the
    // existing row's values with this partial update applied), since an
    // update that only changes, say, backgroundColor to match the
    // existing (unchanged) foregroundColor is exactly the kind of
    // unreadable-QR case a single-field check on backgroundColor alone
    // would miss.
    const effective = {
      size: dto.size ?? existing.size,
      margin: dto.margin ?? existing.margin,
      foregroundColor: dto.foregroundColor ?? existing.foregroundColor,
      backgroundColor: dto.backgroundColor ?? existing.backgroundColor,
    };
    const validation = validateQrConfig(effective);
    if (!validation.valid) {
      throw new BadRequestException(
        validation.reason ?? 'Invalid QR configuration',
      );
    }

    const updated = await this.prisma.qrCode.update({
      where: { id: qrId },
      data,
    });

    await this.audit.record({
      action: 'qr_code.updated',
      entity: 'QrCode',
      entityId: qrId,
      userId,
      workspaceId,
      metadata: { fields: Object.keys(data) },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.webhookEvents.emit({
      type: WebhookEventType.QRCODE_UPDATED,
      workspaceId,
      resourceId: qrId,
      data: { id: updated.id, name: updated.name, fields: Object.keys(data) },
    });

    return updated;
  }

  async softDelete(
    workspaceId: string,
    qrId: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await this.findByIdOrThrow(workspaceId, qrId);

    await this.prisma.qrCode.update({
      where: { id: qrId },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      action: 'qr_code.deleted',
      entity: 'QrCode',
      entityId: qrId,
      userId,
      workspaceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.webhookEvents.emit({
      type: WebhookEventType.QRCODE_DELETED,
      workspaceId,
      resourceId: qrId,
      data: { id: qrId },
    });
  }

  async generateDownload(
    workspaceId: string,
    qrId: string,
    userId: string,
    formatOverride: QrFormat | undefined,
    ctx: RequestContext,
  ): Promise<QrDownload> {
    const qrCode = await this.findByIdOrThrow(workspaceId, qrId);
    const link = await this.prisma.link.findUnique({
      where: { id: qrCode.linkId },
      include: { customDomain: true },
    });
    if (!link) {
      // The link was hard-deleted at the DB level (shouldn't happen in
      // normal operation — Link deletion is soft — but the FK is
      // ON DELETE CASCADE, so treat a genuinely missing link the same as
      // any other "the thing this depended on is gone" case).
      throw new BadRequestException(
        'The link associated with this QR code no longer exists',
      );
    }

    const format = formatOverride ?? qrCode.format;
    const encodedUrl = this.buildEncodedUrl(
      link.shortCode,
      qrCode.name,
      link.customDomain,
    );
    const renderConfig = {
      size: qrCode.size,
      margin: qrCode.margin,
      foregroundColor: qrCode.foregroundColor,
      backgroundColor: qrCode.backgroundColor,
      errorCorrectionLevel: qrCode.errorCorrectionLevel,
    };

    const filenameBase = `linkiq-${slugify(qrCode.name) || 'qr-code'}-qr`;

    let result: QrDownload;
    if (format === QrFormat.SVG) {
      const svg = await this.generator.generateSvg(encodedUrl, renderConfig);
      result = {
        data: svg,
        contentType: 'image/svg+xml',
        filename: `${filenameBase}.svg`,
      };
    } else {
      const png = await this.generator.generatePng(encodedUrl, renderConfig);
      result = {
        data: png,
        contentType: 'image/png',
        filename: `${filenameBase}.png`,
      };
    }

    await this.audit.record({
      action: 'qr_code.downloaded',
      entity: 'QrCode',
      entityId: qrId,
      userId,
      workspaceId,
      metadata: { format },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return result;
  }
}
