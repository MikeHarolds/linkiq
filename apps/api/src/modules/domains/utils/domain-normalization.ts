const MAX_DOMAIN_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Hostnames treated as "local development", exempt from the
 * at-least-one-dot rule below — this sprint must stay fully testable on
 * localhost/test hostnames without real DNS (see engineering rule #20). */
function isLocalDevHostname(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.localtest') ||
    host.endsWith('.local')
  );
}

/**
 * Lowercases/trims a user-supplied domain into the canonical form used for
 * lookups and uniqueness. Tolerant of common paste artifacts (a leading
 * `http(s)://`, a trailing path, a trailing dot) — does NOT strip a port,
 * since a port is only ever meaningful on an *incoming Host header*, never
 * on a domain the user registers (see normalizeHostname in
 * domain-resolver.service.ts for that separate concern).
 */
export function normalizeDomain(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^[a-z]+:\/\//, '');
  value = value.split('/')[0] ?? '';
  if (value.endsWith('.')) {
    value = value.slice(0, -1);
  }
  return value;
}

/**
 * Normalizes an incoming HTTP `Host` header for redirect-time hostname
 * resolution: lowercase, strip a trailing dot, strip an optional port
 * (`go.acme.com:4000` in local dev where the API isn't on 443). Returns
 * undefined for an empty/missing header — callers treat that as "unknown
 * host", never as "default host", since a request with no Host header at
 * all shouldn't be trusted to mean anything in particular.
 */
export function normalizeHostHeader(
  host: string | undefined,
): string | undefined {
  if (!host) return undefined;
  let value = host.trim().toLowerCase();
  if (value.length === 0) return undefined;
  // IPv6 literals arrive as "[::1]:4000" — strip the brackets and any port
  // together rather than naively splitting on ":".
  if (value.startsWith('[')) {
    const closing = value.indexOf(']');
    value = closing !== -1 ? value.slice(1, closing) : value;
  } else {
    value = value.split(':')[0] ?? value;
  }
  if (value.endsWith('.')) {
    value = value.slice(0, -1);
  }
  return value.length > 0 ? value : undefined;
}

export interface DomainValidationResult {
  valid: boolean;
  reason?: string;
  /** Present only when valid. */
  normalized?: string;
}

/**
 * Validates a user-supplied domain's format (charset/label/length rules).
 * Does NOT check uniqueness (a DB concern — see DomainsService, which
 * relies on the unique constraint on normalizedDomain rather than a
 * separate existence check, avoiding a TOCTOU race, the same pattern
 * LinksService uses for shortCode) and does NOT check whether it collides
 * with the platform's own default host (DomainsService checks that via
 * DomainResolverService.isDefaultHost, so the two definitions of "default
 * host" can never drift apart).
 */
export function validateDomainFormat(rawInput: string): DomainValidationResult {
  const normalized = normalizeDomain(rawInput);

  if (normalized.length === 0) {
    return { valid: false, reason: 'Domain is required' };
  }
  if (normalized.length > MAX_DOMAIN_LENGTH) {
    return {
      valid: false,
      reason: `Domain exceeds ${MAX_DOMAIN_LENGTH} characters`,
    };
  }
  if (/\s/.test(normalized)) {
    return { valid: false, reason: 'Domain must not contain whitespace' };
  }

  if (!isLocalDevHostname(normalized) && !normalized.includes('.')) {
    return {
      valid: false,
      reason: 'Domain must include at least one dot (e.g. go.example.com)',
    };
  }

  const labels = normalized.split('.');
  for (const label of labels) {
    if (label.length === 0 || label.length > MAX_LABEL_LENGTH) {
      return {
        valid: false,
        reason: `"${label}" is not a valid domain label`,
      };
    }
    if (!LABEL_PATTERN.test(label)) {
      return {
        valid: false,
        reason: `"${label}" contains characters that aren't valid in a domain`,
      };
    }
  }

  return { valid: true, normalized };
}
