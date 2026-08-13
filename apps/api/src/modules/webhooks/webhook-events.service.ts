import { Injectable } from '@nestjs/common';
import { Prisma, WebhookEndpointStatus, type WebhookEventType } from '@prisma/client';

import { generateOpaqueToken } from '../../common/utils/token';
import { PrismaService } from '../prisma/prisma.service';

import { WebhookDeliveryProducer } from './queue/webhook-delivery.producer';

export interface EmitEventInput {
  type: WebhookEventType;
  workspaceId: string;
  resourceId?: string;
  /** The event's developer-facing payload — becomes the envelope's
   * `data` field. Must never contain secrets — see the call sites in
   * Links/Campaigns/QrCodes/Domains/Billing/ApiKeys services and
   * ClickEventProcessor, which all build this from already-safe,
   * already-public response shapes. */
  data: Record<string, unknown>;
}

/**
 * The single entry point every other service calls to announce "this
 * thing happened" — the "Event Dispatcher" stage of the Sprint 9
 * pipeline. Deliberately does no HTTP: it only ever writes to Postgres
 * (the immutable WebhookEvent record + one WebhookDelivery row per
 * matching active subscription) and enqueues delivery jobs — the actual
 * HTTP delivery belongs exclusively to WebhookDeliveryProcessor. Called
 * from the exact same place `AuditService.record(...)` already sits,
 * after a mutation has successfully committed — never fires merely
 * because an endpoint was called.
 */
@Injectable()
export class WebhookEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly producer: WebhookDeliveryProducer,
  ) {}

  async emit(input: EmitEventInput): Promise<void> {
    const eventId = `evt_${generateOpaqueToken()}`;

    const event = await this.prisma.webhookEvent.create({
      data: {
        id: eventId,
        workspaceId: input.workspaceId,
        type: input.type,
        resourceId: input.resourceId,
        payload: input.data as Prisma.InputJsonValue,
      },
    });

    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        workspaceId: input.workspaceId,
        status: WebhookEndpointStatus.ACTIVE,
        deletedAt: null,
        events: { has: input.type },
      },
      select: { id: true },
    });

    for (const endpoint of endpoints) {
      const delivery = await this.prisma.webhookDelivery.create({
        data: {
          webhookEndpointId: endpoint.id,
          eventId: event.id,
          eventType: input.type,
        },
        select: { id: true },
      });
      this.producer.enqueue({ deliveryId: delivery.id });
    }
  }
}
