import { forwardRef, Module } from '@nestjs/common';

import { WebhooksModule } from '../webhooks/webhooks.module';

import { BillingEventsService } from './billing-events.service';
import { BillingUsageService } from './billing-usage.service';
import { BillingController } from './billing.controller';
import { InvoicesService } from './invoices.service';
import { PlansService } from './plans.service';
import { BILLING_PROVIDER } from './providers/billing-provider.interface';
import { DevelopmentBillingProvider } from './providers/development-billing.provider';
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
 * BILLING_PROVIDER is selected once here based on BILLING_PROVIDER (env);
 * only "development" (the default) has a real implementation this sprint
 * — see DevelopmentBillingProvider's docs. A real Stripe/Paddle/etc.
 * provider later is a new class + one more branch here, nothing else in
 * the billing domain changes.
 *
 * WebhooksModule is imported with forwardRef() (Sprint 9):
 * SubscriptionsService emits subscription.created/.plan_changed/
 * .canceled/.reactivated, and WebhooksModule itself imports BillingModule
 * back for BillingUsageService's MAX_WEBHOOK_ENDPOINTS check — a genuine
 * bidirectional dependency between two cohesive feature modules, not
 * accidental coupling. See webhooks.module.ts's matching forwardRef.
 */
@Module({
  imports: [forwardRef(() => WebhooksModule)],
  controllers: [BillingController],
  providers: [
    PlansService,
    SubscriptionsService,
    BillingUsageService,
    BillingEventsService,
    InvoicesService,
    DevelopmentBillingProvider,
    {
      provide: BILLING_PROVIDER,
      useFactory: (development: DevelopmentBillingProvider) => {
        const mode = process.env.BILLING_PROVIDER ?? 'development';
        // Only "development" is implemented this sprint — any other
        // configured value still falls back to it rather than failing to
        // boot, since no real provider class exists yet to select.
        void mode;
        return development;
      },
      inject: [DevelopmentBillingProvider],
    },
  ],
  exports: [
    PlansService,
    SubscriptionsService,
    BillingUsageService,
    BillingEventsService,
    InvoicesService,
  ],
})
export class BillingModule {}
