import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { BillingModule } from '../billing/billing.module';

import { ApiKeysAuthService } from './api-keys-auth.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { ApiUsageInterceptor } from './interceptors/api-usage.interceptor';
import { ApiUsageProcessor } from './queue/api-usage.processor';
import { ApiUsageProducer } from './queue/api-usage.producer';
import { API_USAGE_QUEUE } from './queue/api-usage.types';

/**
 * API Keys & Developer API Access (Sprint 8).
 *
 * Exports ApiKeysAuthService (consumed by the global JwtAuthGuard — see
 * common/guards/jwt-auth.guard.ts — for the API-key branch of dual-mode
 * authentication), ApiKeysService (the workspace-settings CRUD surface,
 * used only by ApiKeysController here), and ApiUsageInterceptor/Producer
 * (consumed by the global APP_INTERCEPTOR registration in app.module.ts).
 * Imports BillingModule for BillingUsageService's MONTHLY_API_REQUESTS
 * check (Sprint 7's existing aggregate-usage pattern, extended — see
 * billing-usage.service.ts). This module imports nothing from
 * Links/Campaigns/QrCodes/Analytics/Domains — it has no opinion about
 * what an API key is *allowed* to do, only whether one is valid and how
 * much it's been used. Actual authorization (@ApiPermission checks) lives
 * in WorkspaceRolesGuard, which those modules already depend on.
 */
@Module({
  imports: [BillingModule, BullModule.registerQueue({ name: API_USAGE_QUEUE })],
  controllers: [ApiKeysController],
  providers: [
    ApiKeysService,
    ApiKeysAuthService,
    ApiUsageProducer,
    ApiUsageProcessor,
    // Registered here (not in AppModule) so its own constructor
    // dependencies (BillingUsageService, ApiUsageProducer) resolve from
    // this module's own scope — the same pattern JwtAuthGuard's APP_GUARD
    // registration already uses in auth.module.ts, for the same reason.
    { provide: APP_INTERCEPTOR, useClass: ApiUsageInterceptor },
  ],
  exports: [ApiKeysService, ApiKeysAuthService],
})
export class ApiKeysModule {}
