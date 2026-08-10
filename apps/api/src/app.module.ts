import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import analyticsConfig from './config/analytics.config';
import appConfig from './config/app.config';
import authConfig from './config/auth.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { LinksModule } from './modules/links/links.module';
import { LoggingModule } from './modules/logging/logging.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { QueueModule } from './modules/queue/queue.module';
import { RedisModule } from './modules/redis/redis.module';
import { UsersModule } from './modules/users/users.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';

const disableRateLimitForTests =
  process.env.DISABLE_RATE_LIMIT_FOR_TESTS === 'true';

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
      ],
      envFilePath: ['.env'],
    }),
    LoggingModule,
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
    AuthModule,
    UsersModule,
    WorkspacesModule,
    LinksModule,
    AnalyticsModule,
    // Campaigns, QrCodes, Domains, Billing, Webhooks, and Admin modules
    // are added in subsequent milestones.
  ],
  providers: [
    // ThrottlerModule.forRoot() alone only registers configuration — it does
    // NOT enforce anything without a guard actually applying it. Registering
    // it globally here is what makes every @Throttle(...) override (and the
    // default global limit) actually take effect on every route.
    //
    // DISABLE_RATE_LIMIT_FOR_TESTS exists solely for the business-logic e2e
    // suites (auth/workspaces), which legitimately fire far more requests
    // per minute against auth endpoints than the real per-endpoint limits
    // allow. Nest's testing-module `overrideGuard()` does NOT reliably
    // intercept guards registered via APP_GUARD (verified empirically), so
    // this env-gated conditional is the mechanism that actually works.
    // Rate limiting itself is verified for real, with this guard fully
    // active, in test/rate-limit.e2e-spec.ts.
    ...(disableRateLimitForTests
      ? []
      : [{ provide: APP_GUARD, useClass: ThrottlerGuard }]),
  ],
})
export class AppModule {}
