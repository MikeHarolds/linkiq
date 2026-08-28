/**
 * LinkIQ service worker — app-shell + static-asset caching only.
 *
 * SECURITY-CRITICAL RULE: this worker never intercepts anything except
 * same-origin GET requests for a small, explicit allowlist of static
 * paths. Everything else — every API call (same-origin auth proxy at
 * /api/v1/auth/*, and every cross-origin call to NEXT_PUBLIC_API_URL),
 * every non-GET request, every cross-origin request of any kind — falls
 * straight through to the network exactly as if this worker didn't
 * exist. That is what keeps auth responses, billing/invoice data,
 * admin data, analytics, and Set-Cookie headers out of the Cache
 * Storage API entirely; there is no cache-then-filter step to get
 * wrong, the fetch handler simply never touches those requests.
 *
 * CACHE_VERSION must change on every deploy that changes cached assets
 * (Next's own build-hashed filenames under /_next/static/ already
 * self-invalidate; this version exists for the small app-shell list
 * below). Bumping it is what makes `activate` drop the previous
 * cache — see the update-flow comment near the bottom for why a plain
 * "cache forever" service worker would otherwise pin users to a stale
 * deployment indefinitely.
 */
const CACHE_VERSION = 'linkiq-shell-v1';

const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Mirrors src/lib/pwa-cache-policy.ts's isCacheableStaticPath exactly —
// a classic (non-module) service worker can't import that file, so this
// is a duplicate, not a delegate. pwa-cache-policy.test.ts asserts these
// two lists stay identical; keep them in sync by hand if either changes.
const CACHEABLE_STATIC_PATH_PREFIXES = ['/_next/static/', '/icons/'];
const CACHEABLE_STATIC_PATHS = [
  '/manifest.webmanifest',
  '/favicon.svg',
  '/logo.svg',
  '/offline.html',
];

function isCacheableStaticPath(pathname) {
  if (CACHEABLE_STATIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) {
    return true;
  }
  return CACHEABLE_STATIC_PATHS.includes(pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      // Never let one missing/failed shell asset block installation —
      // runtime caching below still fills in anything missed here.
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only ever consider GET — POST/PUT/PATCH/DELETE (every mutating API
  // call) must always hit the network fresh.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin (including every direct call to NEXT_PUBLIC_API_URL
  // when the API lives on a different host, e.g. Render's split
  // linkiq-web/linkiq-api services) — never intercept.
  if (url.origin !== self.location.origin) return;

  // Same-origin but API-shaped (covers the /api/v1/auth/* rewrite
  // proxy) — never intercept. This is the single most important line
  // in this file: it is what keeps Set-Cookie-bearing auth responses
  // out of the cache even though they're same-origin.
  if (url.pathname.startsWith('/api/')) return;

  if (!isCacheableStaticPath(url.pathname) && url.pathname !== '/') return;

  // Navigations (the app shell "/" and any other page request the
  // browser tags as "navigate") — network-first so a signed-in user
  // always gets a live, personalized render; only fall back to the
  // cached shell/offline page when genuinely offline. Dashboard/admin
  // pages are never added to APP_SHELL and are therefore never served
  // stale from cache — this branch only ever returns the generic shell
  // or offline page, never a cached authenticated page (none exists).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(
        () =>
          caches.match('/') ??
          caches.match('/offline.html') ??
          new Response('You appear to be offline. Reconnect to continue.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          }),
      ),
    );
    return;
  }

  // Static assets: stale-while-revalidate. Next's /_next/static/ files
  // are content-hashed (a new deploy ships new filenames), so serving a
  // cached copy is always safe; revalidating in the background keeps
  // the cache warm for the next load without blocking this one.
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => undefined);
      return cached ?? (await network) ?? new Response(null, { status: 504 });
    }),
  );
});

// Update flow: activate() above already drops any previous
// CACHE_VERSION and claims clients immediately (skipWaiting +
// clients.claim), so a newly deployed worker takes over without
// waiting for every open tab to close. The client-side registration
// (see components/pwa/register-service-worker.tsx) listens for
// `controllerchange` and reloads once, so a running tab picks up the
// new deployment's JS/CSS instead of continuing to run stale code
// indefinitely against a live app shell.
