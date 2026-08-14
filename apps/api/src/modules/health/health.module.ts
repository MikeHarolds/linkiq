import { Module } from '@nestjs/common';
import { PrismaHealthIndicator, TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './indicators/redis.health';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, RedisHealthIndicator],
  // RedisHealthIndicator is this module's own provider (PrismaHealthIndicator
  // comes from TerminusModule and is already resolvable anywhere that imports
  // TerminusModule directly) — exported so AdminModule's system-health
  // endpoint (Sprint 11) can reuse the exact same indicator instead of a
  // second implementation.
  exports: [RedisHealthIndicator],
})
export class HealthModule {}
