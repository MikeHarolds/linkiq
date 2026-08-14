import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optimistic route gating based on whether the httpOnly refresh cookie is
 * present — NOT whether it's actually still valid (middleware can't call
 * the API to check that without adding a network round-trip to every
 * navigation). This exists purely for UX: skip the flash of a page the
 * user almost certainly can't use. The real authorization boundary is
 * every protected API endpoint rejecting requests without a valid access
 * token — see apps/api's global JwtAuthGuard. AuthProvider's client-side
 * redirect (in the dashboard layout) is the second, source-of-truth-aware
 * layer: it redirects to /login if the silent refresh actually fails.
 */
const REFRESH_COOKIE_NAME =
  process.env.NEXT_PUBLIC_REFRESH_COOKIE_NAME ?? 'linkiq_refresh_token';

const AUTH_ONLY_ROUTES = ['/login', '/register'];
// /admin gets the same cookie-presence gate as /dashboard — this is
// still only a UX optimism check, never the real authorization boundary.
// The actual SUPER_ADMIN check happens twice, both server-side of this
// middleware: the (admin) layout's client effect (redirects a
// non-SUPER_ADMIN user away, UX-only) and, decisively, SuperAdminGuard
// on every /admin/* API endpoint (see apps/api's
// common/guards/super-admin.guard.ts) — a workspace ADMIN with a valid
// session cookie still gets 403 from the API no matter what this
// middleware or the layout does.
const PROTECTED_ROUTE_PREFIXES = ['/dashboard', '/admin'];

export function middleware(request: NextRequest) {
  const hasSessionCookie = request.cookies.has(REFRESH_COOKIE_NAME);
  const { pathname } = request.nextUrl;

  if (
    PROTECTED_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix)) &&
    !hasSessionCookie
  ) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (AUTH_ONLY_ROUTES.includes(pathname) && hasSessionCookie) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*', '/login', '/register'],
};
