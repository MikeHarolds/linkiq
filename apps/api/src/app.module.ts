import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import analyticsConfig from './config/analytics.config';
import appConfig from './config/app.config';
import authConfig from './config/auth.config';
import brandingConfig from './config/branding.config';
import databaseConfig from './config/database.config';
import emailConfig from './config/email.config';
import paystackConfig from './config/paystack.config';
import redisConfig from './config/redis.config';
import webhooksConfig from './config/webhooks.config';
import { AdminModule } from './modules/admin/admin.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { BrandingModule } from './modules/branding/branding.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { DomainsModule } from './modules/domains/domains.module';
import { EmailModule } from './modules/email/email.module';
import { HealthModule } from './modules/health/health.module';
import { LandingPageModule } from './modules/landing-page/landing-page.module';
import { LinkSourcesModule } from './modules/link-sources/link-sources.module';
import { LinksModule } from './modules/links/links.module';
import { LoggingModule } from './modules/logging/logging.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { PublicModule } from './modules/public/public.module';
import { QrCodesModule } from './modules/qr-codes/qr-codes.module';
import { QueueModule } from './modules/queue/queue.module';
import { RedisModule } from './modules/redis/redis.module';
import { ReportsModule } from './modules/reports/reports.module';
import { UsersModule } from './modules/users/users.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        authConfig,
        analyticsConfig,
        webhooksConfig,
        paystackConfig,
        brandingConfig,
        emailConfig,
      ],
      envFilePath: ['.env'],
    }),
    LoggingModule,
    // ThrottlerModule.forRoot() alone only registers configuration — it does
    // NOT enforce anything without a guard actually applying it. The guard
    // itself (ApiKeyAwareThrottlerGuard) is registered as APP_GUARD in
    // auth.module.ts, not here — see that module's docs for why relative
    // ordering against JwtAuthGuard matters. ThrottlerModule is @Global(),
    // so its exports (ThrottlerModuleOptions/ThrottlerStorage) still reach
    // that guard from auth.module.ts without an explicit import there.
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL ?? 60) * 1000,
        limit: Number(process.env.THROTTLE_LIMIT ?? 100),
      },
    ]),
    PrismaModule,
    RedisModule,
    QueueModule,
    AuditModule,
    HealthModule,
    BillingModule,
    ApiKeysModule,
    AuthModule,
    UsersModule,
    WorkspacesModule,
    LinksModule,
    AnalyticsModule,
    QrCodesModule,
    LinkSourcesModule,
    CampaignsModule,
    DomainsModule,
    WebhooksModule,
    LandingPageModule,
    BrandingModule,
    EmailModule,
    ReportsModule,
    PublicModule,
    AdminModule,
  ],
})
export class AppModule {}
