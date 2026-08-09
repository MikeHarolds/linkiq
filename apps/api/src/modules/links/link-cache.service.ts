import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Link } from '@prisma/client';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.module';

/** The subset of a Link's fields the redirect hot path actually needs. */
export interface CachedLink {
  id: string;
  workspaceId: string;
  destinationUrl: string;
  status: string;
  isActive: boolean;
  expiresAt: string | null; // ISO string — Redis only stores strings
}

const CACHE_KEY_PREFIX = 'link:shortcode:';
const POSITIVE_TTL_SECONDS = 300; // 5 minutes
const NEGATIVE_TTL_SECONDS = 30; // short TTL for "not found", to limit DB hammering from repeated bad requests without caching a miss for long
const NOT_FOUND_SENTINEL = '__NOT_FOUND__';

/**
 * Read-through cache for shortCode → link resolution, the single
 * highest-volume query in the system. Shared by RedirectService (reads)
 * and LinksService (invalidates on every mutation) so there is exactly
 * one place that knows the cache key format and TTL policy.
 */
@Injectable()
export class LinkCacheService {
  private readonly logger = new Logger(LinkCacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(shortCode: string): string {
    return `${CACHE_KEY_PREFIX}${shortCode}`;
  }

  /**
   * Returns the cached link, `null` if negatively cached (known not to
   * exist), or `undefined` on a cache miss (caller should fall back to
   * the database). Never throws — a Redis outage degrades to "always
   * fall back to Postgres", not a broken redirect path.
   */
  async get(shortCode: string): Promise<CachedLink | null | undefined> {
    try {
      const raw = await this.redis.get(this.key(shortCode));
      if (raw === null) return undefined;
      if (raw === NOT_FOUND_SENTINEL) return null;
      return JSON.parse(raw) as CachedLink;
    } catch (error) {
      this.logger.warn(
        `Cache read failed for "${shortCode}": ${String(error)}`,
      );
      return undefined;
    }
  }

  async set(shortCode: string, link: Link): Promise<void> {
    const cached: CachedLink = {
      id: link.id,
      workspaceId: link.workspaceId,
      destinationUrl: link.destinationUrl,
      status: link.status,
      isActive: link.isActive,
      expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
    };
    try {
      await this.redis.set(
        this.key(shortCode),
        JSON.stringify(cached),
        'EX',
        POSITIVE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Cache write failed for "${shortCode}": ${String(error)}`,
      );
    }
  }

  async setNotFound(shortCode: string): Promise<void> {
    try {
      await this.redis.set(
        this.key(shortCode),
        NOT_FOUND_SENTINEL,
        'EX',
        NEGATIVE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Negative-cache write failed for "${shortCode}": ${String(error)}`,
      );
    }
  }

  /** Called on every link mutation (update/pause/activate/archive/delete). */
  async invalidate(shortCode: string): Promise<void> {
    try {
      await this.redis.del(this.key(shortCode));
    } catch (error) {
      this.logger.warn(
        `Cache invalidation failed for "${shortCode}": ${String(error)}`,
      );
    }
  }
}
