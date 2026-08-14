import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';

import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import { RedisHealthIndicator } from '../../health/indicators/redis.health';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueHealthIndicator } from '../indicators/queue-health.indicator';
import { AdminSettingsService } from '../services/admin-settings.service';

/**
 * Platform system health — SUPER_ADMIN only. Reuses the exact same
 * Terminus indicators the public `/health` endpoint already uses
 * (Postgres via Prisma, Redis, process memory — see health.module.ts),
 * plus a new queue-depth indicator (no BullMQ Terminus indicator existed
 * before this sprint) and a Paystack connectivity check. Every result
 * here is a REAL check against the real dependency, never a hardcoded
 * "healthy" placeholder.
 */
@ApiTags('admin-health')
@ApiBearerAuth()
@Controller('admin/system-health')
@UseGuards(SuperAdminGuard)
export class AdminHealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly memoryHealth: MemoryHealthIndicator,
    private readonly queueHealth: QueueHealthIndicator,
    private readonly settings: AdminSettingsService,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary:
      'Full platform health: API, database, Redis, queues, Paystack (SUPER_ADMIN only)',
  })
  async check() {
    const [terminusResult, paystack] = await Promise.all([
      this.health.check([
        () => this.prismaHealth.pingCheck('database', this.prisma),
        () => this.redisHealth.isHealthy('redis'),
        () => this.memoryHealth.checkHeap('memory_heap', 300 * 1024 * 1024),
        () => this.queueHealth.isHealthy('queues'),
      ]),
      this.settings.testPaystackConnection(),
    ]);

    return { ...terminusResult, paystack };
  }
}
