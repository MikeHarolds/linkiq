import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';

import { WebhookDeliveryProcessor } from './queue/webhook-delivery.processor';
import { WebhookDeliveryProducer } from './queue/webhook-delivery.producer';
import { WEBHOOK_DELIVERY_QUEUE } from './queue/webhook-delivery.types';
import { WebhookSecretCipherService } from './security/webhook-secret-cipher.service';
import { WebhookUrlGuard } from './security/webhook-url-guard';
import { WebhookEventsService } from './webhook-events.service';
import { WebhookSignatureService } from './webhook-signature.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/**
 * Webhooks & Event Delivery (Sprint 9).
 *
 * Exports WebhookEventsService — the single `emit(...)` entry point every
 * other module (Links/Campaigns/QrCodes/Domains/Billing/ApiKeys/
 * Analytics) calls immediately after a mutation commits, mirroring how
 * AuditService is already imported everywhere. This module has no
 * opinion about what a link or campaign is, only about matching an event
 * type to subscribed endpoints and delivering it. Imports BillingModule
 * for MAX_WEBHOOK_ENDPOINTS enforcement (Sprint 7's existing pattern) and
 * AuditModule for the webhook.* audit trail (Sprint 8's existing
 * pattern).
 *
 * BillingModule is wrapped in forwardRef(): SubscriptionsService (inside
 * BillingModule) also needs WebhookEventsService, to emit
 * subscription.created/.plan_changed/.canceled/.reactivated — a genuine
 * bidirectional dependency between two cohesive feature modules, not a
 * design smell. See billing.module.ts's matching forwardRef and docs.
 */
@Module({
  imports: [
    AuditModule,
    forwardRef(() => BillingModule),
    BullModule.registerQueue({ name: WEBHOOK_DELIVERY_QUEUE }),
  ],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhookEventsService,
    WebhookSignatureService,
    WebhookUrlGuard,
    WebhookSecretCipherService,
    WebhookDeliveryProducer,
    WebhookDeliveryProcessor,
  ],
  exports: [WebhookEventsService],
})
export class WebhooksModule {}
