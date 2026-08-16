import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { ApiKeysModule } from '../api-keys/api-keys.module';
import { API_USAGE_QUEUE } from '../api-keys/queue/api-usage.types';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { PAYSTACK_WEBHOOK_QUEUE } from '../billing/providers/paystack/queue/paystack-webhook.types';
import { BrandingModule } from '../branding/branding.module';
import { DomainsModule } from '../domains/domains.module';
import { HealthModule } from '../health/health.module';
import { LandingPageModule } from '../landing-page/landing-page.module';
import { CLICK_EVENT_QUEUE } from '../links/queue/click-event.types';
import { WEBHOOK_DELIVERY_QUEUE } from '../webhooks/queue/webhook-delivery.types';
import { WebhooksModule } from '../webhooks/webhooks.module';

import { AdminApiUsageController } from './controllers/admin-api-usage.controller';
import { AdminAuditLogsController } from './controllers/admin-audit-logs.controller';
import { AdminBrandingController } from './controllers/admin-branding.controller';
import { AdminDomainsController } from './controllers/admin-domains.controller';
import { AdminHealthController } from './controllers/admin-health.controller';
import { AdminInvoicesController } from './controllers/admin-invoices.controller';
import { AdminLandingPageController } from './controllers/admin-landing-page.controller';
import { AdminOverviewController } from './controllers/admin-overview.controller';
import { AdminPaymentsController } from './controllers/admin-payments.controller';
import { AdminPlansController } from './controllers/admin-plans.controller';
import { AdminSettingsController } from './controllers/admin-settings.controller';
import { AdminSubscriptionsController } from './controllers/admin-subscriptions.controller';
import { AdminUsersController } from './controllers/admin-users.controller';
import { AdminWebhooksController } from './controllers/admin-webhooks.controller';
import { AdminWorkspacesController } from './controllers/admin-workspaces.controller';
import { QueueHealthIndicator } from './indicators/queue-health.indicator';
import { AdminApiUsageService } from './services/admin-api-usage.service';
import { AdminOverviewService } from './services/admin-overview.service';
import { AdminSettingsService } from './services/admin-settings.service';
import { AdminUsersService } from './services/admin-users.service';
import { AdminWebhooksService } from './services/admin-webhooks.service';
import { AdminWorkspacesService } from './services/admin-workspaces.service';

/**
 * Platform Administration / Super Admin (Sprint 11).
 *
 * Every controller here is guarded by SuperAdminGuard (see
 * common/guards/super-admin.guard.ts) — a workspace OWNER/ADMIN never
 * gains access no matter which module they own, since SuperAdminGuard
 * checks `User.globalRole`, a platform-level field with no relationship
 * to `WorkspaceRole` at all. This module is deliberately additive: it
 * reuses BillingModule/WebhooksModule/DomainsModule/ApiKeysModule/
 * AuthModule/HealthModule's existing services wherever one already does
 * what an admin view needs (see each admin service's own docs for
 * exactly which existing method it calls) rather than re-implementing
 * subscription mutation, webhook retry, domain listing, or session
 * revocation a second time. The four BullMQ queues are re-registered
 * here (not re-exported from their owning modules) purely so
 * QueueHealthIndicator can read job counts — registering the same queue
 * name twice gives each module its own client against the same
 * Redis-backed queue, it does not create a second queue.
 */
@Module({
  imports: [
    BillingModule,
    WebhooksModule,
    DomainsModule,
    ApiKeysModule,
    AuthModule,
    HealthModule,
    TerminusModule,
    LandingPageModule,
    BrandingModule,
    BullModule.registerQueue(
      { name: CLICK_EVENT_QUEUE },
      { name: WEBHOOK_DELIVERY_QUEUE },
      { name: API_USAGE_QUEUE },
      { name: PAYSTACK_WEBHOOK_QUEUE },
    ),
  ],
  controllers: [
    AdminOverviewController,
    AdminUsersController,
    AdminWorkspacesController,
    AdminSubscriptionsController,
    AdminPlansController,
    AdminPaymentsController,
    AdminInvoicesController,
    AdminApiUsageController,
    AdminWebhooksController,
    AdminDomainsController,
    AdminAuditLogsController,
    AdminSettingsController,
    AdminHealthController,
    AdminLandingPageController,
    AdminBrandingController,
  ],
  providers: [
    AdminUsersService,
    AdminWorkspacesService,
    AdminApiUsageService,
    AdminWebhooksService,
    AdminSettingsService,
    AdminOverviewService,
    QueueHealthIndicator,
  ],
})
export class AdminModule {}
