/**
 * The exact same caching-eligibility rule public/sw.js's fetch handler
 * implements — kept here as a real, unit-tested TypeScript function
 * because a classic (non-module) service worker script can't `import`
 * external files, so public/sw.js necessarily has its own copy of this
 * logic. src/lib/pwa-cache-policy.test.ts's "stays in sync with
 * public/sw.js" test reads both files' source and fails the build if
 * they drift — that's what makes this the actual source of truth
 * rather than parallel logic nobody's testing.
 *
 * This is the single security-critical decision behind Sprint 21's
 * caching requirement: never cache anything except a same-origin GET to
 * a known-static path. Everything else (every API call, same-origin or
 * cross-origin; every mutating request) must fall through to the
 * network untouched.
 */

const CACHEABLE_STATIC_PATH_PREFIXES = ['/_next/static/', '/icons/'];
const CACHEABLE_STATIC_PATHS = [
  '/manifest.webmanifest',
  '/favicon.svg',
  '/logo.svg',
  '/offline.html',
];

export function isCacheableStaticPath(pathname: string): boolean {
  if (CACHEABLE_STATIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) {
    return true;
  }
  return CACHEABLE_STATIC_PATHS.includes(pathname);
}

export interface CachePolicyInput {
  method: string;
  requestOrigin: string;
  swOrigin: string;
  pathname: string;
}

/**
 * True only when this request is even eligible to be served from /
 * written to the cache. False means "let it hit the network exactly as
 * if no service worker were installed" — which is the required
 * behavior for every API call (same-origin /api/v1/auth/* proxy calls
 * included) and every non-GET request.
 */
export function isCacheEligible({
  method,
  requestOrigin,
  swOrigin,
  pathname,
}: CachePolicyInput): boolean {
  if (method !== 'GET') return false;
  if (requestOrigin !== swOrigin) return false;
  if (pathname.startsWith('/api/')) return false;
  return pathname === '/' || isCacheableStaticPath(pathname);
}
