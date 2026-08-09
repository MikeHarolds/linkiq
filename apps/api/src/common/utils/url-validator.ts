const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Schemes that must never be accepted as a link destination, checked
 * explicitly (in addition to the allow-list above) so the rejection
 * reason is unambiguous in logs/tests rather than just "not http(s)".
 */
const DANGEROUS_PROTOCOLS = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'blob:',
  'about:',
]);

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  /** Canonicalized URL string, only present when valid. */
  normalized?: string;
}

const MAX_URL_LENGTH = 2048;

/**
 * Validates a link destination URL. Accepts only absolute http/https URLs.
 * Deliberately does NOT reject localhost/private-IP destinations — the
 * redirect is a 302 sent to the requester's own browser, not a server-side
 * fetch, so there's no SSRF exposure from allowing them (this is an open
 * redirect service by design; that's what a URL shortener is).
 */
export function validateDestinationUrl(rawUrl: string): UrlValidationResult {
  const trimmed = rawUrl.trim();

  if (trimmed.length === 0) {
    return { valid: false, reason: 'URL is required' };
  }

  if (trimmed.length > MAX_URL_LENGTH) {
    return { valid: false, reason: `URL exceeds ${MAX_URL_LENGTH} characters` };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'URL is malformed' };
  }

  if (DANGEROUS_PROTOCOLS.has(parsed.protocol)) {
    return {
      valid: false,
      reason: `Protocol "${parsed.protocol}" is not allowed`,
    };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return {
      valid: false,
      reason: 'Only http:// and https:// URLs are supported',
    };
  }

  if (!parsed.hostname) {
    return { valid: false, reason: 'URL must include a host' };
  }

  // Normalize via URL's own serialization (canonicalizes default ports,
  // percent-encoding, etc.) without altering the semantic destination —
  // we do NOT strip trailing slashes, lowercase the path, or touch the
  // query string, since any of those could change what the destination
  // server actually serves.
  return { valid: true, normalized: parsed.toString() };
}
