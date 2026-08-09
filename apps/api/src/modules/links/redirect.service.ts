import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { LinkCacheService, type CachedLink } from './link-cache.service';
import { ClickEventProducer } from './queue/click-event.producer';

export type RedirectOutcome =
  | { kind: 'redirect'; destinationUrl: string }
  | { kind: 'not_found' }
  | { kind: 'paused' }
  | { kind: 'expired' }
  | { kind: 'archived' };

export interface RedirectRequestMeta {
  ipAddress?: string;
  userAgent?: string;
  referer?: string;
}

/**
 * Resolves a short code to a redirect outcome. This is the single
 * highest-traffic path in the system — see the module-level docs in
 * links.module.ts for the full flow. Every step here is intentionally
 * minimal: one cache read, at most one DB read, no joins, no synchronous
 * writes on the success path (the click event is enqueued, not written).
 */
@Injectable()
export class RedirectService {
  private readonly logger = new Logger(RedirectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: LinkCacheService,
    private readonly clickEvents: ClickEventProducer,
  ) {}

  async resolve(
    shortCode: string,
    meta: RedirectRequestMeta,
  ): Promise<RedirectOutcome> {
    let link = await this.cache.get(shortCode);

    if (link === undefined) {
      // Cache miss — fall back to the database, then populate the cache
      // either way (positive or negative) so the next request for this
      // code, valid or not, is served from Redis.
      const dbLink = await this.prisma.link.findUnique({
        where: { shortCode },
      });

      if (!dbLink || dbLink.deletedAt !== null) {
        await this.cache.setNotFound(shortCode);
        return { kind: 'not_found' };
      }

      await this.cache.set(shortCode, dbLink);
      link = {
        id: dbLink.id,
        workspaceId: dbLink.workspaceId,
        destinationUrl: dbLink.destinationUrl,
        status: dbLink.status,
        isActive: dbLink.isActive,
        expiresAt: dbLink.expiresAt ? dbLink.expiresAt.toISOString() : null,
      };
    }

    if (link === null) {
      // Negatively cached — known not to exist as of the last check.
      return { kind: 'not_found' };
    }

    const outcome = this.evaluateState(link);
    if (outcome.kind !== 'redirect') {
      return outcome;
    }

    this.clickEvents.enqueue({
      linkId: link.id,
      workspaceId: link.workspaceId,
      occurredAt: new Date().toISOString(),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      referer: meta.referer,
    });

    return outcome;
  }

  private evaluateState(link: CachedLink): RedirectOutcome {
    if (link.status === 'ARCHIVED') {
      return { kind: 'archived' };
    }
    if (link.status === 'PAUSED') {
      return { kind: 'paused' };
    }
    if (link.expiresAt && new Date(link.expiresAt).getTime() < Date.now()) {
      return { kind: 'expired' };
    }
    if (!link.isActive) {
      // Defensive: isActive should already be false whenever status isn't
      // ACTIVE, but don't let a redirect happen on a stale/inconsistent
      // cache entry — treat it the same as "not found" rather than
      // guessing at a more specific reason.
      this.logger.warn(
        `Link resolved with inconsistent state (status=${link.status}, isActive=false)`,
      );
      return { kind: 'not_found' };
    }
    return { kind: 'redirect', destinationUrl: link.destinationUrl };
  }
}
