import { Injectable } from '@nestjs/common';
import { DomainStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { DomainCacheService, type CachedDomain } from './domain-cache.service';
import { normalizeHostHeader } from './utils/domain-normalization';

export type HostResolution =
  | { kind: 'default' }
  | { kind: 'custom'; domain: CachedDomain }
  | { kind: 'unknown' };

/** Extracts just the hostname (no port/protocol) from APP_URL — the
 * platform's own default redirect host, always treated as "default"
 * regardless of REDIRECT_DEFAULT_HOSTS. */
function defaultAppHostname(): string {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  try {
    return new URL(appUrl).hostname.toLowerCase();
  } catch {
    return 'localhost';
  }
}

function extraDefaultHosts(): Set<string> {
  const raw = process.env.REDIRECT_DEFAULT_HOSTS ?? '';
  return new Set(
    raw
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h.length > 0),
  );
}

/** Loopback hostnames are always treated as the default host, regardless
 * of APP_URL/REDIRECT_DEFAULT_HOSTS — local tooling (curl, supertest,
 * browsers hitting the API directly in dev) commonly addresses the API by
 * "127.0.0.1" even when APP_URL says "localhost", and neither could ever
 * legitimately be someone else's registered custom domain. Without this,
 * every e2e test driving the redirect route through supertest (which
 * talks to an ephemeral 127.0.0.1 port) would see its own request
 * rejected as an "unknown host". */
const ALWAYS_DEFAULT_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Resolves an incoming request's hostname to either "the default LinkIQ
 * host" (existing behavior, untouched) or a workspace's custom domain.
 * This is the single seam RedirectService/PublicUrlService/DomainsService
 * all go through for "what counts as the platform's own host" — see
 * domains.module.ts for how it's shared across modules.
 */
@Injectable()
export class DomainResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: DomainCacheService,
  ) {}

  /** Pure, synchronous — true if `normalizedHost` is the platform's own
   * default host (APP_URL's hostname, plus any REDIRECT_DEFAULT_HOSTS
   * entries), never a registrable custom domain. */
  isDefaultHost(normalizedHost: string): boolean {
    const host = normalizedHost.toLowerCase();
    return (
      ALWAYS_DEFAULT_HOSTS.has(host) ||
      host === defaultAppHostname() ||
      extraDefaultHosts().has(host)
    );
  }

  async resolveHost(rawHost: string | undefined): Promise<HostResolution> {
    const normalizedHost = normalizeHostHeader(rawHost);
    if (!normalizedHost) {
      // No Host header at all — real HTTP requests always carry one, so
      // this realistically only happens for direct/internal service
      // calls. Treat it the same as the default host rather than
      // "unknown", so nothing that doesn't go through a browser's Host
      // header is ever affected by this sprint.
      return { kind: 'default' };
    }
    if (this.isDefaultHost(normalizedHost)) {
      return { kind: 'default' };
    }

    let domain = await this.cache.get(normalizedHost);

    if (domain === undefined) {
      const dbDomain = await this.prisma.customDomain.findUnique({
        where: { normalizedDomain: normalizedHost },
      });

      if (!dbDomain || dbDomain.deletedAt !== null) {
        await this.cache.setNotFound(normalizedHost);
        return { kind: 'unknown' };
      }

      await this.cache.set(normalizedHost, dbDomain);
      domain = {
        id: dbDomain.id,
        workspaceId: dbDomain.workspaceId,
        normalizedDomain: dbDomain.normalizedDomain,
        status: dbDomain.status,
      };
    }

    if (domain === null) {
      return { kind: 'unknown' };
    }

    // Only an ACTIVE domain may resolve redirects — PENDING/VERIFYING/
    // VERIFIED/FAILED/DISABLED all mean "not currently serving traffic".
    if (domain.status !== DomainStatus.ACTIVE) {
      return { kind: 'unknown' };
    }

    return { kind: 'custom', domain };
  }
}
