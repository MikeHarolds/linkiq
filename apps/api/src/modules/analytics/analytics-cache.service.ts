import { createHash } from 'crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.module';

const CACHE_PREFIX = 'analytics:';
/** Short TTL by design — aggregates should feel close to real-time, this
 * is purely to absorb repeated dashboard-refresh load, not to serve stale
 * data for long. Never used for raw per-event data (see class docs). */
const DEFAULT_TTL_SECONDS = 60;

/**
 * Caches computed AGGREGATE analytics responses only — never raw
 * ClickEvent rows. Every cache key is namespaced by workspaceId, so a
 * cache lookup can never return one workspace's data for another's
 * request even under a key-construction bug elsewhere (the workspaceId
 * segment is mandatory, not optional, in `buildKey`).
 */
@Injectable()
export class AnalyticsCacheService {
  private readonly logger = new Logger(AnalyticsCacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private buildKey(
    workspaceId: string,
    endpoint: string,
    params: Record<string, unknown>,
  ): string {
    const paramsHash = createHash('sha256')
      .update(JSON.stringify(params))
      .digest('hex')
      .slice(0, 16);
    return `${CACHE_PREFIX}${workspaceId}:${endpoint}:${paramsHash}`;
  }

  async get<T>(
    workspaceId: string,
    endpoint: string,
    params: Record<string, unknown>,
  ): Promise<T | undefined> {
    try {
      const raw = await this.redis.get(
        this.buildKey(workspaceId, endpoint, params),
      );
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch (error) {
      this.logger.warn(`Analytics cache read failed: ${String(error)}`);
      return undefined;
    }
  }

  async set(
    workspaceId: string,
    endpoint: string,
    params: Record<string, unknown>,
    value: unknown,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    try {
      await this.redis.set(
        this.buildKey(workspaceId, endpoint, params),
        JSON.stringify(value),
        'EX',
        ttlSeconds,
      );
    } catch (error) {
      this.logger.warn(`Analytics cache write failed: ${String(error)}`);
    }
  }

  /** Invalidates every cached analytics response for a workspace — used
   * sparingly (analytics don't need aggressive invalidation the way
   * link-resolution caching does, since a 60s-stale count is fine, but
   * this exists for completeness / testability). */
  async invalidateWorkspace(workspaceId: string): Promise<void> {
    try {
      const keys = await this.redis.keys(`${CACHE_PREFIX}${workspaceId}:*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      this.logger.warn(`Analytics cache invalidation failed: ${String(error)}`);
    }
  }
}
