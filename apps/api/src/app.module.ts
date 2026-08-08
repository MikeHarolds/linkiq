import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import appConfig from './config/app.config';
import authConfig from './config/auth.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import { HealthModule } from './modules/health/health.module';
import { LoggingModule } from './modules/logging/logging.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { QueueModule } from './modules/queue/queue.module';
import { RedisModule } from './modules/redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, redisConfig, authConfig],
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
    HealthModule,
    // Auth, Users, Links, Campaigns, QrCodes, Domains, Analytics, Billing,
    // Webhooks, and Admin modules are added in subsequent milestones.
  ],
})
export class AppModule {}
