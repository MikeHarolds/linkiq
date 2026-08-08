import { Module } from '@nestjs/common';
import { PrismaHealthIndicator, TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './indicators/redis.health';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
