import type { IncomingHttpHeaders } from 'http';
import { isIP } from 'net';

/**
 * Number of trusted reverse-proxy hops in front of the API. The
 * deployed topology (infrastructure/nginx/linkiq.conf) is a single
 * nginx hop: `internet client -> nginx -> api`. nginx sets
 * `X-Forwarded-For: $proxy_add_x_forwarded_for`, which APPENDS its own
 * view of the connecting peer onto whatever the client already sent —
 * it never replaces it. That means only the last `TRUSTED_PROXY_HOPS`
 * entries in X-Forwarded-For were actually written by something we
 * trust; everything before that boundary may be entirely
 * attacker-supplied and must never be used as the client's IP.
 *
 * Bump this (via env var) only when an additional trusted layer is
 * added in front of nginx (e.g. a CDN that itself appends to
 * X-Forwarded-For) — never to "fix" a spoofing symptom, since that
 * usually means the boundary was miscounted, not too narrow.
 */
function getTrustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Extra trusted hops crossed ONLY by a request that arrives via this
 * app's own Next.js rewrite proxy (apps/web/next.config.js) instead of
 * hitting the API directly — the short-link redirect route, plus the
 * login/register/refresh auth endpoints (see auth-provider.tsx's
 * SAME_ORIGIN_API_PREFIX). Self-hosted nginx never takes this path at
 * all (infrastructure/nginx/linkiq.conf routes both of those straight
 * to the API in one hop, matching TRUSTED_PROXY_HOPS alone), so this
 * defaults to 0 there and must stay unset. On a split-hostname
 * deployment (Render, or Codespaces' forwarded ports) a proxied
 * request crosses the SAME front-line boundary TWICE — once reaching
 * linkiq-web, once again when linkiq-web's own outbound rewrite
 * request reaches linkiq-api — live-confirmed on Render via a
 * temporary header dump: a direct request to linkiq-api carried
 * exactly 3 trusted-appended X-Forwarded-For entries (Cloudflare +
 * Render's two internal routing hops), and the identical request
 * proxied through linkiq-web carried exactly 6 (the same 3 crossed
 * twice) — hence this being a genuinely separate, independently
 * configured value rather than an assumption that it always equals
 * TRUSTED_PROXY_HOPS again (a different split-hostname platform, e.g.
 * Codespaces, could have a different front-line depth on each side).
 */
function getWebProxyExtraHops(): number {
  const raw = process.env.WEB_PROXY_TRUSTED_HOPS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Trusted-hop count for a call site that is ALWAYS reached via this
 * app's own rewrite proxy in a split-hostname deployment (the redirect
 * route; the login/register/refresh auth endpoints) — see
 * getWebProxyExtraHops() above for why this can't just reuse
 * getTrustedProxyHops() unchanged. Safe to call unconditionally in
 * every deployment: on self-hosted nginx, where this scenario never
 * happens, WEB_PROXY_TRUSTED_HOPS stays unset (0) and this is
 * identical to the base hop count.
 */
export function getViaWebProxyTrustedHops(): number {
  return getTrustedProxyHops() + getWebProxyExtraHops();
}

/** Validates and normalizes a single header value that should contain
 * exactly one IP address — never a comma-separated list. Returns
 * undefined for anything that doesn't parse as IPv4 or IPv6. */
function asValidIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return isIP(trimmed) !== 0 ? trimmed : undefined;
}

function singleHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Extracts the client's real IP address, given the actual LinkIQ
 * reverse-proxy topology and its trust boundary — see
 * getTrustedProxyHops() above. Used by both the redirect route (for
 * click-event geo lookups) and the @Ctx() decorator (for audit
 * logging), which must stay behaviorally identical; this function is
 * the single source of truth for both.
 *
 * Precedence:
 * 1. X-Real-IP, but ONLY when exactly one hop is trusted — nginx
 *    always overwrites this header with $remote_addr (never appends a
 *    client-supplied value), so it's the simplest, unambiguous signal
 *    for a directly-fronting single proxy. It is NOT sufficient for a
 *    multi-hop chain (it only ever reflects the immediate peer, not N
 *    hops back), so it's skipped entirely when trustedHops > 1.
 * 2. X-Forwarded-For, walked back exactly `trustedHops` entries from
 *    the end — the only entries a trusted hop could have appended.
 *    Never the first entry: that position is whatever the original
 *    client sent and is fully attacker-controlled.
 * 3. The raw socket peer address — correct for local dev / no
 *    reverse proxy in front of the API at all.
 *
 * Every candidate is validated as a syntactically real IPv4/IPv6
 * address before being trusted; a malformed value at any step is
 * skipped rather than returned, falling through to the next signal.
 */
export function extractClientIp(
  headers: IncomingHttpHeaders,
  socketRemoteAddress: string | undefined,
  trustedHops: number = getTrustedProxyHops(),
): string | undefined {
  if (trustedHops === 1) {
    const realIp = asValidIp(singleHeaderValue(headers['x-real-ip']));
    if (realIp) return realIp;
  }

  const forwardedFor = singleHeaderValue(headers['x-forwarded-for']);
  if (forwardedFor) {
    const entries = forwardedFor
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length > 0) {
      const boundaryIndex = Math.max(0, entries.length - trustedHops);
      const candidate = asValidIp(entries[boundaryIndex]);
      if (candidate) return candidate;
    }
  }

  return asValidIp(socketRemoteAddress);
}
