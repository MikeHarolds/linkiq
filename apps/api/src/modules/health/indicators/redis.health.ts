import { Inject, Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '../../redis/redis.module';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const pong = await this.redis.ping();
      const isHealthy = pong === 'PONG';
      const result = this.getStatus(key, isHealthy);

      if (!isHealthy) {
        throw new HealthCheckError('Redis check failed', result);
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, { message }),
      );
    }
  }
}
