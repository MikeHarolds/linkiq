import { randomBytes } from 'crypto';

import { hashToken } from './token';

/**
 * LinkIQ API key format: `lk_live_<192 bits of random, URL-safe data>`.
 * Never a UUID, timestamp, or incremental id — those are guessable or
 * enumerable; this is generated the same way `generateOpaqueToken` (see
 * ./token.ts) generates refresh/reset tokens, just with a recognizable,
 * non-secret prefix so a leaked key is instantly identifiable as a LinkIQ
 * credential in logs/scanners.
 */
const API_KEY_PREFIX = 'lk_live_';
/** Characters of the secret (after the prefix) kept visible in
 * `keyPrefix` for UI display, e.g. "lk_live_ab12cd34••••••••". */
const PREFIX_DISPLAY_CHARS = 8;

export interface GeneratedApiKey {
  /** The full secret — returned to the caller exactly once, never stored. */
  rawKey: string;
  /** Safe to persist and display; cannot be used to authenticate. */
  keyPrefix: string;
  /** sha256(rawKey) — the only form of the secret ever persisted. */
  keyHash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(24).toString('base64url'); // 192 bits
  const rawKey = `${API_KEY_PREFIX}${secret}`;
  return {
    rawKey,
    keyPrefix: rawKey.slice(0, API_KEY_PREFIX.length + PREFIX_DISPLAY_CHARS),
    keyHash: hashToken(rawKey),
  };
}

/** Cheap prefix check used to route a Bearer token to API-key auth instead
 * of JWT auth, before any hashing or database lookup — see JwtAuthGuard. */
export function looksLikeApiKey(bearerToken: string): boolean {
  return bearerToken.startsWith(API_KEY_PREFIX);
}
