import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isCacheEligible, isCacheableStaticPath } from './pwa-cache-policy';

const SW_ORIGIN = 'https://linkiq-web.onrender.com';

describe('isCacheEligible — the security-critical no-caching rule', () => {
  it('rejects every /api/ path, including the same-origin auth proxy', () => {
    expect(
      isCacheEligible({
        method: 'GET',
        requestOrigin: SW_ORIGIN,
        swOrigin: SW_ORIGIN,
        pathname: '/api/v1/auth/refresh',
      }),
    ).toBe(false);
    expect(
      isCacheEligible({
        method: 'GET',
        requestOrigin: SW_ORIGIN,
        swOrigin: SW_ORIGIN,
        pathname: '/api/v1/auth/login',
      }),
    ).toBe(false);
  });

  it('rejects every non-GET method regardless of path', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(
        isCacheEligible({
          method,
          requestOrigin: SW_ORIGIN,
          swOrigin: SW_ORIGIN,
          pathname: '/manifest.webmanifest',
        }),
      ).toBe(false);
    }
  });

  it('rejects cross-origin requests — e.g. a direct call to the API origin', () => {
    expect(
      isCacheEligible({
        method: 'GET',
        requestOrigin: 'https://linkiq-api.onrender.com',
        swOrigin: SW_ORIGIN,
        pathname: '/api/v1/analytics/overview',
      }),
    ).toBe(false);
  });

  it('rejects dashboard/admin/analytics/billing pages — only the shell and static assets are eligible', () => {
    for (const pathname of [
      '/dashboard',
      '/dashboard/analytics',
      '/dashboard/billing',
      '/admin',
      '/admin/settings/email',
    ]) {
      expect(
        isCacheEligible({
          method: 'GET',
          requestOrigin: SW_ORIGIN,
          swOrigin: SW_ORIGIN,
          pathname,
        }),
      ).toBe(false);
    }
  });

  it('accepts the app shell root and known static asset paths', () => {
    for (const pathname of [
      '/',
      '/manifest.webmanifest',
      '/favicon.svg',
      '/logo.svg',
      '/offline.html',
      '/icons/icon-192.png',
      '/_next/static/chunks/main.js',
    ]) {
      expect(
        isCacheEligible({
          method: 'GET',
          requestOrigin: SW_ORIGIN,
          swOrigin: SW_ORIGIN,
          pathname,
        }),
      ).toBe(true);
    }
  });
});

describe('isCacheableStaticPath', () => {
  it('rejects unknown paths', () => {
    expect(isCacheableStaticPath('/dashboard')).toBe(false);
    expect(isCacheableStaticPath('/api/v1/auth/login')).toBe(false);
  });
});

describe('public/sw.js stays in sync with this module', () => {
  it('mirrors the same static-path allowlist and the /api/ bypass', () => {
    const swSource = readFileSync(
      join(__dirname, '../../public/sw.js'),
      'utf8',
    );

    expect(swSource).toContain(
      "const CACHEABLE_STATIC_PATH_PREFIXES = ['/_next/static/', '/icons/'];",
    );
    expect(swSource).toContain("'/manifest.webmanifest'");
    expect(swSource).toContain("'/favicon.svg'");
    expect(swSource).toContain("'/logo.svg'");
    expect(swSource).toContain("'/offline.html'");

    // The bypass check itself, and that it happens before any caching
    // call — a request path starting with /api/ must never reach
    // caches.open/cache.put.
    const bypassIndex = swSource.indexOf("pathname.startsWith('/api/')");
    const firstCacheWrite = swSource.indexOf('caches.open');
    expect(bypassIndex).toBeGreaterThan(-1);
    expect(firstCacheWrite).toBeGreaterThan(-1);
    expect(bypassIndex).toBeLessThan(firstCacheWrite);

    // Non-GET requests must be rejected before that same point too.
    const methodCheckIndex = swSource.indexOf("request.method !== 'GET'");
    expect(methodCheckIndex).toBeGreaterThan(-1);
    expect(methodCheckIndex).toBeLessThan(firstCacheWrite);

    // Cross-origin requests must be rejected before that same point.
    const originCheckIndex = swSource.indexOf(
      'url.origin !== self.location.origin',
    );
    expect(originCheckIndex).toBeGreaterThan(-1);
    expect(originCheckIndex).toBeLessThan(firstCacheWrite);
  });
});
