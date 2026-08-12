import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CustomDomain } from '@prisma/client';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.module';

/** The subset of a CustomDomain's fields the redirect hot path needs. */
export interface CachedDomain {
  id: string;
  workspaceId: string;
  normalizedDomain: string;
  status: string;
}

const CACHE_KEY_PREFIX = 'domain:host:';
const POSITIVE_TTL_SECONDS = 300; // 5 minutes — same policy as LinkCacheService
const NEGATIVE_TTL_SECONDS = 30;
const NOT_FOUND_SENTINEL = '__NOT_FOUND__';

/**
 * Read-through cache for hostname -> CustomDomain resolution, mirroring
 * LinkCacheService exactly (same TTL policy, same "never throws" contract
 * on a Redis outage) since custom-domain requests sit on the same redirect
 * hot path as default-host requests once they arrive.
 */
@Injectable()
export class DomainCacheService {
  private readonly logger = new Logger(DomainCacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(normalizedHost: string): string {
    return `${CACHE_KEY_PREFIX}${normalizedHost}`;
  }

  async get(normalizedHost: string): Promise<CachedDomain | null | undefined> {
    try {
      const raw = await this.redis.get(this.key(normalizedHost));
      if (raw === null) return undefined;
      if (raw === NOT_FOUND_SENTINEL) return null;
      return JSON.parse(raw) as CachedDomain;
    } catch (error) {
      this.logger.warn(
        `Cache read failed for host "${normalizedHost}": ${String(error)}`,
      );
      return undefined;
    }
  }

  async set(normalizedHost: string, domain: CustomDomain): Promise<void> {
    const cached: CachedDomain = {
      id: domain.id,
      workspaceId: domain.workspaceId,
      normalizedDomain: domain.normalizedDomain,
      status: domain.status,
    };
    try {
      await this.redis.set(
        this.key(normalizedHost),
        JSON.stringify(cached),
        'EX',
        POSITIVE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Cache write failed for host "${normalizedHost}": ${String(error)}`,
      );
    }
  }

  async setNotFound(normalizedHost: string): Promise<void> {
    try {
      await this.redis.set(
        this.key(normalizedHost),
        NOT_FOUND_SENTINEL,
        'EX',
        NEGATIVE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Negative-cache write failed for host "${normalizedHost}": ${String(error)}`,
      );
    }
  }

  /** Called on every domain mutation (create/update/verify/activate/disable/delete). */
  async invalidate(normalizedHost: string): Promise<void> {
    try {
      await this.redis.del(this.key(normalizedHost));
    } catch (error) {
      this.logger.warn(
        `Cache invalidation failed for host "${normalizedHost}": ${String(error)}`,
      );
    }
  }
}
