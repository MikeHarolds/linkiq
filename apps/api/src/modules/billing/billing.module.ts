import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';

import { WebhooksModule } from '../webhooks/webhooks.module';

import { BillingEventsService } from './billing-events.service';
import { BillingUsageService } from './billing-usage.service';
import { BillingController } from './billing.controller';
import { InvoicesService } from './invoices.service';
import { PlansService } from './plans.service';
import { BILLING_PROVIDER } from './providers/billing-provider.interface';
import { DevelopmentBillingProvider } from './providers/development-billing.provider';
import { PaystackApiClient } from './providers/paystack/paystack-api.client';
import { PaystackBillingProvider } from './providers/paystack/paystack-billing.provider';
import { PaystackSignatureService } from './providers/paystack/paystack-signature.service';
import { PaystackWebhookController } from './providers/paystack/paystack-webhook.controller';
import { PaystackWebhookProcessor } from './providers/paystack/queue/paystack-webhook.processor';
import { PaystackWebhookProducer } from './providers/paystack/queue/paystack-webhook.producer';
import { PAYSTACK_WEBHOOK_QUEUE } from './providers/paystack/queue/paystack-webhook.types';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Billing & Subscription Management (Sprint 7).
 *
 * Exports SubscriptionsService (used by AuthModule/WorkspacesModule to
 * create a workspace's default FREE subscription inside their own
 * creation transactions) and BillingUsageService (used by
 * Links/QrCodes/Campaigns/Domains/Workspaces to enforce plan limits).
 * Every usage count is a direct `prisma.<model>.count()`, the same
 * pattern LinksService.getWorkspaceStats already uses.
 *
 * BILLING_PROVIDER is selected once here based on BILLING_PROVIDER (env):
 * "development" (default) never calls out anywhere (DevelopmentBillingProvider);
 * "paystack" (Sprint 10) is the first real implementation
 * (PaystackBillingProvider). Any other/unrecognized value falls back to
 * development rather than failing to boot. A future second real provider
 * is a new class + one more branch here, nothing else in the billing
 * domain changes.
 *
 * WebhooksModule is imported with forwardRef() (Sprint 9):
 * SubscriptionsService emits subscription.created/.plan_changed/
 * .canceled/.reactivated, and WebhooksModule itself imports BillingModule
 * back for BillingUsageService's MAX_WEBHOOK_ENDPOINTS check — a genuine
 * bidirectional dependency between two cohesive feature modules, not
 * accidental coupling. See webhooks.module.ts's matching forwardRef.
 */
@Module({
  imports: [
    forwardRef(() => WebhooksModule),
    BullModule.registerQueue({ name: PAYSTACK_WEBHOOK_QUEUE }),
  ],
  controllers: [BillingController, PaystackWebhookController],
  providers: [
    PlansService,
    SubscriptionsService,
    BillingUsageService,
    BillingEventsService,
    InvoicesService,
    DevelopmentBillingProvider,
    PaystackApiClient,
    PaystackBillingProvider,
    PaystackSignatureService,
    PaystackWebhookProducer,
    PaystackWebhookProcessor,
    {
      provide: BILLING_PROVIDER,
      useFactory: (
        development: DevelopmentBillingProvider,
        paystack: PaystackBillingProvider,
      ) => {
        const mode = process.env.BILLING_PROVIDER ?? 'development';
        if (mode === 'paystack') {
          return paystack;
        }
        return development;
      },
      inject: [DevelopmentBillingProvider, PaystackBillingProvider],
    },
  ],
  // PaystackApiClient added to exports in Sprint 11 — AdminModule's
  // settings service reuses it for a read-only "test connection" check
  // (see admin-settings.service.ts), never a second Paystack client.
  // BILLING_PROVIDER added in Sprint 14 — AdminPlansController injects
  // it directly (not through PlansService, which would create a
  // circular dependency with PaystackBillingProvider — see
  // plans.service.ts's create() docs) to optionally sync a newly
  // created plan to the provider's own plan catalog.
  exports: [
    PlansService,
    SubscriptionsService,
    BillingUsageService,
    BillingEventsService,
    InvoicesService,
    PaystackApiClient,
    BILLING_PROVIDER,
  ],
})
export class BillingModule {}
