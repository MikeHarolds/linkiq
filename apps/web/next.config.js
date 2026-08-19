/** @type {import('next').NextConfig} */

// Server-only (deliberately NOT prefixed NEXT_PUBLIC_ — never bundled to
// the browser). The browser always talks to this same origin (localhost
// in dev, the public domain in production, via NEXT_PUBLIC_APP_URL); it's
// Next's own server process that needs to reach the API directly to proxy
// short-link redirects below. Distinct from NEXT_PUBLIC_API_URL, which is
// browser-facing and includes the /api/v1 path — this is the API's bare
// origin. Defaults to the API's default local-dev port.
const API_ORIGIN = (process.env.API_ORIGIN ?? 'http://localhost:4000').replace(
  /\/+$/,
  '',
);

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Workspace packages ship TypeScript source directly (no build step),
  // so Next must transpile them itself.
  transpilePackages: ['@linkiq/ui', '@linkiq/utils', '@linkiq/types'],

  // Proxies LinkIQ short-link requests (the URLs PublicUrlService
  // generates, e.g. http://localhost:3000/abc1234) to the API's redirect
  // route (GET /:shortCode — see apps/api/src/modules/links/redirect-route.ts).
  // That route only ever existed on the API's own port; nothing on the
  // web origin previously forwarded to it, which is what produced a
  // Next.js 404 for every generated short link.
  //
  // The `source` pattern is deliberately scoped to LinkIQ's actual
  // short-code shape, not a catch-all: auto-generated codes are exactly
  // 7 base62 characters, and custom slugs are 3-50 characters of
  // [A-Za-z0-9_-] (see apps/api/src/common/utils/short-code.ts, the
  // single source of truth for both formats — AUTO_CODE_LENGTH,
  // CUSTOM_SLUG_MIN_LENGTH/MAX_LENGTH, CUSTOM_SLUG_PATTERN). A 3-50
  // character `[A-Za-z0-9_-]` class covers both.
  //
  // Rewrites run in Next's default `afterFiles` phase: every real
  // page/route this app already serves (/, /login, /register,
  // /dashboard/*, /_next/* internals, /public static assets like
  // favicon.ico) is matched by Next's own filesystem router FIRST and
  // never reaches this rule — this rewrite only ever fires for a single
  // path segment that isn't an existing page. /api/* isn't a Next route
  // at all here (the API is a separate process), but the pattern is a
  // single dynamic segment anyway, so it structurally can't match any
  // multi-segment path like /api/v1/... regardless.
  async rewrites() {
    return [
      // Proxies the cookie-setting auth endpoints (login/register/refresh/
      // logout) to the API so the browser sees Set-Cookie as coming from
      // this app's own origin. On a split-hostname deployment (Render's
      // two separate services, or Codespaces' forwarded ports), a cookie
      // the API sets on its own host is never visible back to this app's
      // origin — no Domain attribute means a host-only cookie (RFC 6265),
      // so both middleware.ts's cookie check and this app's own
      // silent-refresh-on-mount always saw "no cookie", even right after
      // a successful login. See apps/web/src/lib/api-client.ts's
      // SAME_ORIGIN_API_PREFIX comment for the full explanation — this is
      // the other half of that fix.
      {
        source: '/api/v1/auth/:path*',
        destination: `${API_ORIGIN}/api/v1/auth/:path*`,
      },
      {
        source: '/:shortCode([A-Za-z0-9_-]{3,50})',
        destination: `${API_ORIGIN}/:shortCode`,
      },
    ];
  },
};

module.exports = nextConfig;
