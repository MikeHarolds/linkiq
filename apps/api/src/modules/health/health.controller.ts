import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';

import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

import { RedisHealthIndicator } from './indicators/redis.health';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly memoryHealth: MemoryHealthIndicator,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Liveness/readiness check',
    description:
      'Reports application status plus the health of its direct dependencies (PostgreSQL via Prisma, Redis, and process memory). Public — used by load balancers, container orchestrators, and uptime monitors, which do not authenticate.',
  })
  check() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
      () => this.redisHealth.isHealthy('redis'),
      () => this.memoryHealth.checkHeap('memory_heap', 300 * 1024 * 1024),
    ]);
  }
}
