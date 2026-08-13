import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WebhookDeliveryStatus,
  WebhookEndpointStatus,
  WebhookEventType,
  type WebhookEndpoint,
} from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { generateOpaqueToken } from '../../common/utils/token';
import { generateWebhookSecret } from '../../common/utils/webhook-secret';
import { AuditService } from '../audit/audit.service';
import { BillingUsageService } from '../billing/billing-usage.service';
import { PrismaService } from '../prisma/prisma.service';

import type { CreateWebhookDto } from './dto/create-webhook.dto';
import type { QueryDeliveriesDto } from './dto/query-deliveries.dto';
import type { UpdateWebhookDto } from './dto/update-webhook.dto';
import { WIRE_NAME_TO_EVENT_TYPE, EVENT_TYPE_WIRE_NAME } from './event-catalog';
import { WebhookDeliveryProducer } from './queue/webhook-delivery.producer';
import { WebhookSecretCipherService } from './security/webhook-secret-cipher.service';
import { WebhookUrlGuard } from './security/webhook-url-guard';

/** Retrying an already-terminal delivery is allowed; retrying one still
 * in flight (or already delivered) is not — matches §23's "manual retry
 * creates a new attempt on the same logical delivery", which only makes
 * sense once automatic retries have stopped. */
const RETRYABLE_DELIVERY_STATUSES: WebhookDeliveryStatus[] = [
  WebhookDeliveryStatus.FAILED,
  WebhookDeliveryStatus.EXHAUSTED,
];

export type SafeWebhookEndpoint = Omit<WebhookEndpoint, 'secretCiphertext'>;

/** Every field except secretCiphertext, explicit rather than an omit — the
 * one column that must never leave this service, same pattern
 * ApiKeysService established in Sprint 8. */
const SAFE_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  url: true,
  secretPrefix: true,
  events: true,
  status: true,
  consecutiveFailures: true,
  lastDeliveryAt: true,
  lastSuccessAt: true,
  lastFailureAt: true,
  createdById: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => BillingUsageService))
    private readonly billingUsage: BillingUsageService,
    private readonly urlGuard: WebhookUrlGuard,
    private readonly secretCipher: WebhookSecretCipherService,
    private readonly producer: WebhookDeliveryProducer,
  ) {}

  private toEventTypes(wireNames: string[]) {
    return wireNames.map((name) => WIRE_NAME_TO_EVENT_TYPE[name]!);
  }

  private toWireNames(eventTypes: WebhookEndpoint['events']) {
    return eventTypes.map((type) => EVENT_TYPE_WIRE_NAME[type]);
  }

  /** Response shape used by every read/mutation method — events
   * translated back to their dotted wire form (§event-catalog.ts). */
  private toResponse(endpoint: SafeWebhookEndpoint) {
    return { ...endpoint, events: this.toWireNames(endpoint.events) };
  }

  async create(
    workspaceId: string,
    userId: string,
    dto: CreateWebhookDto,
    ctx: RequestContext,
  ) {
    await this.urlGuard.assertSafe(dto.url);
    await this.billingUsage.assertCanUse(
      workspaceId,
      'MAX_WEBHOOK_ENDPOINTS',
      'webhook endpoints',
    );

    const { rawSecret, secretPrefix } = generateWebhookSecret();
    const secretCiphertext = this.secretCipher.encrypt(rawSecret);

    const endpoint = await this.prisma.webhookEndpoint.create({
      data: {
        workspaceId,
        name: dto.name,
        url: dto.url,
        secretPrefix,
        secretCiphertext,
        events: this.toEventTypes(dto.events),
        createdById: userId,
      },
      select: SAFE_SELECT,
    });

    await this.audit.record({
      action: 'webhook.created',
      entity: 'WebhookEndpoint',
      entityId: endpoint.id,
      userId,
      workspaceId,
      metadata: { name: endpoint.name, url: endpoint.url, events: dto.events },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { ...this.toResponse(endpoint), secret: rawSecret };
  }

  async findAll(workspaceId: string) {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { workspaceId, deletedAt: null },
      select: SAFE_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return endpoints.map((e) => this.toResponse(e));
  }

  async findByIdOrThrow(workspaceId: string, id: string) {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id, workspaceId, deletedAt: null },
      select: SAFE_SELECT,
    });
    if (!endpoint) {
      throw new NotFoundException('Webhook endpoint not found');
    }
    return this.toResponse(endpoint);
  }

  /** Internal — includes secretCiphertext, used only by the delivery
   * worker and by findByIdOrThrow's own lookup. Never returned from a
   * controller. */
  async findRawByIdOrThrow(id: string): Promise<WebhookEndpoint> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id, deletedAt: null },
    });
    if (!endpoint) {
      throw new NotFoundException('Webhook endpoint not found');
    }
    return endpoint;
  }

  async update(
    workspaceId: string,
    id: string,
    userId: string,
    dto: UpdateWebhookDto,
    ctx: RequestContext,
  ) {
    await this.findByIdOrThrow(workspaceId, id);

    if (dto.url !== undefined) {
      await this.urlGuard.assertSafe(dto.url);
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.url !== undefined) data.url = dto.url;
    if (dto.events !== undefined) data.events = this.toEventTypes(dto.events);

    const updated = await this.prisma.webhookEndpoint.update({
      where: { id },
      data,
      select: SAFE_SELECT,
    });

    await this.audit.record({
      action: 'webhook.updated',
      entity: 'WebhookEndpoint',
      entityId: id,
      userId,
      workspaceId,
      metadata: { fields: Object.keys(dto) },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.toResponse(updated);
  }

  async pause(
    workspaceId: string,
    id: string,
    userId: string,
    ctx: RequestContext,
  ) {
    const existing = await this.findByIdOrThrow(workspaceId, id);
    if (existing.status === WebhookEndpointStatus.PAUSED) {
      throw new BadRequestException('Webhook endpoint is already paused');
    }

    const updated = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: { status: WebhookEndpointStatus.PAUSED },
      select: SAFE_SELECT,
    });

    await this.audit.record({
      action: 'webhook.paused',
      entity: 'WebhookEndpoint',
      entityId: id,
      userId,
      workspaceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.toResponse(updated);
  }

  /** Reactivating also resets consecutiveFailures — a fresh start,
   * whether the endpoint was manually paused or auto-disabled (§21). */
  async activate(
    workspaceId: string,
    id: string,
    userId: string,
    ctx: RequestContext,
  ) {
    const existing = await this.findByIdOrThrow(workspaceId, id);
    if (existing.status === WebhookEndpointStatus.ACTIVE) {
      throw new BadRequestException('Webhook endpoint is already active');
    }

    const updated = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: { status: WebhookEndpointStatus.ACTIVE, consecutiveFailures: 0 },
      select: SAFE_SELECT,
    });

    await this.audit.record({
      action: 'webhook.activated',
      entity: 'WebhookEndpoint',
      entityId: id,
      userId,
      workspaceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.toResponse(updated);
  }

  async rotateSecret(
    workspaceId: string,
    id: string,
    userId: string,
    ctx: RequestContext,
  ) {
    await this.findByIdOrThrow(workspaceId, id);

    const { rawSecret, secretPrefix } = generateWebhookSecret();
    const secretCiphertext = this.secretCipher.encrypt(rawSecret);
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: { secretPrefix, secretCiphertext },
      select: SAFE_SELECT,
    });

    await this.audit.record({
      action: 'webhook.secret_rotated',
      entity: 'WebhookEndpoint',
      entityId: id,
      userId,
      workspaceId,
      metadata: { secretPrefix },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { ...this.toResponse(updated), secret: rawSecret };
  }

  async softDelete(
    workspaceId: string,
    id: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await this.findByIdOrThrow(workspaceId, id);

    await this.prisma.webhookEndpoint.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      action: 'webhook.deleted',
      entity: 'WebhookEndpoint',
      entityId: id,
      userId,
      workspaceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /** Confirms the endpoint belongs to this workspace, then paginates its
   * delivery history — never includes the event payload (kept to the
   * single-delivery detail view below) so the list stays cheap. */
  async listDeliveries(
    workspaceId: string,
    endpointId: string,
    query: QueryDeliveriesDto,
  ) {
    await this.findByIdOrThrow(workspaceId, endpointId);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.WebhookDeliveryWhereInput = {
      webhookEndpointId: endpointId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.webhookDelivery.count({ where }),
    ]);

    return {
      items: items.map((d) => this.toDeliveryResponse(d)),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize) || 1,
      },
    };
  }

  /** Includes the event envelope (type/createdAt/data) for inspection —
   * still never the endpoint's secret, which this query doesn't select. */
  async getDeliveryOrThrow(
    workspaceId: string,
    endpointId: string,
    deliveryId: string,
  ) {
    await this.findByIdOrThrow(workspaceId, endpointId);

    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, webhookEndpointId: endpointId },
      include: { event: true },
    });
    if (!delivery) {
      throw new NotFoundException('Webhook delivery not found');
    }

    return {
      ...this.toDeliveryResponse(delivery),
      event: {
        id: delivery.event.id,
        type: EVENT_TYPE_WIRE_NAME[delivery.event.type],
        createdAt: delivery.event.createdAt,
        data: delivery.event.payload,
      },
    };
  }

  /** Enqueues exactly one additional attempt on the same logical
   * delivery — same eventId, same deliveryId, attemptCount keeps
   * incrementing. Only valid once automatic retries have already
   * stopped (FAILED with no more attempts, or EXHAUSTED). */
  async retryDelivery(
    workspaceId: string,
    endpointId: string,
    deliveryId: string,
    userId: string,
    ctx: RequestContext,
  ) {
    const endpoint = await this.findByIdOrThrow(workspaceId, endpointId);
    if (endpoint.status !== WebhookEndpointStatus.ACTIVE) {
      throw new BadRequestException(
        'Cannot retry a delivery for a paused or disabled endpoint',
      );
    }

    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, webhookEndpointId: endpointId },
    });
    if (!delivery) {
      throw new NotFoundException('Webhook delivery not found');
    }
    if (!RETRYABLE_DELIVERY_STATUSES.includes(delivery.status)) {
      throw new BadRequestException(
        `Cannot manually retry a delivery in ${delivery.status} status`,
      );
    }

    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: WebhookDeliveryStatus.PENDING },
    });

    // A manual retry is one explicit attempt, not a fresh automatic
    // retry cascade — see WebhookDeliveryProducer's `attempts` override.
    this.producer.enqueue({ deliveryId }, 1);

    await this.audit.record({
      action: 'webhook.manual_retry',
      entity: 'WebhookDelivery',
      entityId: deliveryId,
      userId,
      workspaceId,
      metadata: { endpointId },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.toDeliveryResponse({ ...delivery, status: WebhookDeliveryStatus.PENDING });
  }

  /**
   * Sends a `webhook.test` delivery to exactly this endpoint, using the
   * same signing/delivery infra as a real event — bypassing the normal
   * event-type subscription matching in WebhookEventsService.emit()
   * since WEBHOOK_TEST is never a subscribable event (§32). Clearly
   * identifiable to the receiver via `type: "webhook.test"`.
   */
  async sendTestEvent(
    workspaceId: string,
    endpointId: string,
    userId: string,
  ) {
    const endpoint = await this.findByIdOrThrow(workspaceId, endpointId);

    const event = await this.prisma.webhookEvent.create({
      data: {
        id: `evt_${generateOpaqueToken()}`,
        workspaceId,
        type: WebhookEventType.WEBHOOK_TEST,
        payload: {
          message: 'This is a test event sent from LinkIQ.',
          endpointId,
          triggeredBy: userId,
        },
      },
    });

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        webhookEndpointId: endpoint.id,
        eventId: event.id,
        eventType: WebhookEventType.WEBHOOK_TEST,
      },
      select: { id: true },
    });

    this.producer.enqueue({ deliveryId: delivery.id });

    return { eventId: event.id, deliveryId: delivery.id };
  }

  private toDeliveryResponse(delivery: {
    id: string;
    webhookEndpointId: string;
    eventId: string;
    eventType: WebhookEventType;
    attemptCount: number;
    status: WebhookDeliveryStatus;
    responseStatus: number | null;
    responseTimeMs: number | null;
    lastAttemptAt: Date | null;
    nextAttemptAt: Date | null;
    deliveredAt: Date | null;
    failureReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return { ...delivery, eventType: EVENT_TYPE_WIRE_NAME[delivery.eventType] };
  }
}
