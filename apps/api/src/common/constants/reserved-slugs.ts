/**
 * Short codes that can never be claimed as a link's shortCode — they'd
 * collide with real application routes (or common decoy/abuse paths).
 * Centralized here so every place that needs the list (slug validation,
 * future admin tooling) shares exactly one source of truth.
 *
 * Extend this list freely; it's plain data, not load-bearing logic.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(
  [
    // Real application routes
    'api',
    'admin',
    'login',
    'register',
    'logout',
    'dashboard',
    'settings',
    'docs',
    'health',
    'auth',
    'links',
    'workspaces',
    'users',
    'billing',
    'campaigns',
    'analytics',
    'qr',
    'webhooks',
    'forgot-password',
    'reset-password',
    // Common decoy / abuse-prone paths worth blocking preemptively
    'www',
    'app',
    'static',
    'assets',
    'public',
    'favicon.ico',
    'robots.txt',
    'sitemap.xml',
    '.well-known',
    'null',
    'undefined',
  ].map((slug) => slug.toLowerCase()),
);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}
