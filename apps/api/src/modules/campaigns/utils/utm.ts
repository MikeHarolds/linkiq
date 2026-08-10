export const UTM_FIELD_TO_PARAM = {
  utmSource: 'utm_source',
  utmMedium: 'utm_medium',
  utmCampaign: 'utm_campaign',
  utmTerm: 'utm_term',
  utmContent: 'utm_content',
} as const;

export type UtmFieldName = keyof typeof UTM_FIELD_TO_PARAM;

export interface UtmValues {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
}

const MAX_UTM_VALUE_LENGTH = 255;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/;
/** Defense-in-depth against values that would be actively dangerous if
 * some future view ever rendered a UTM value unescaped — not because
 * URLSearchParams needs it (it percent-encodes everything safely
 * regardless), but because these values also surface in the dashboard UI
 * as plain text/labels. */
const DANGEROUS_VALUE_PATTERN = /<script|javascript:|data:text\/html/i;

export interface UtmValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates a single UTM value. Deliberately permissive on punctuation/
 * spacing (real campaign names are free text — "Summer Sale 2026" is a
 * completely normal utm_campaign value) — this is about rejecting
 * garbage/injection-shaped input and enforcing a sane length, not about
 * restricting UTM values to a slug-like charset the way short codes are.
 */
export function validateUtmValue(value: string): UtmValidationResult {
  if (value.length === 0) {
    return { valid: false, reason: 'Value cannot be empty' };
  }
  if (value.length > MAX_UTM_VALUE_LENGTH) {
    return {
      valid: false,
      reason: `Value must be at most ${MAX_UTM_VALUE_LENGTH} characters`,
    };
  }
  if (CONTROL_CHAR_PATTERN.test(value)) {
    return {
      valid: false,
      reason: 'Value contains invalid control characters',
    };
  }
  if (DANGEROUS_VALUE_PATTERN.test(value)) {
    return { valid: false, reason: 'Value contains disallowed content' };
  }
  return { valid: true };
}

/** Validates every provided (non-null/undefined) field in a UtmValues
 * object, returning the first failure found — used by both campaign and
 * link create/update so the two "UTM builder" entry points share one
 * rulebook. */
export function validateUtmValues(utm: UtmValues): UtmValidationResult {
  for (const field of Object.keys(UTM_FIELD_TO_PARAM) as UtmFieldName[]) {
    const value = utm[field];
    if (value === undefined || value === null) continue;
    const result = validateUtmValue(value);
    if (!result.valid) {
      return {
        valid: false,
        reason: `${UTM_FIELD_TO_PARAM[field]}: ${result.reason}`,
      };
    }
  }
  return { valid: true };
}

/**
 * Applies UTM parameters onto a base URL, returning the resulting full
 * URL string. Every property this function is deliberately built around:
 *
 *   - Existing, non-UTM query parameters are always preserved untouched.
 *   - A UTM field with a value REPLACES any existing same-named param in
 *     the base URL — never duplicates it (URLSearchParams.set(), not
 *     .append()).
 *   - A UTM field that is null/undefined/empty is left alone entirely —
 *     whatever the base URL already had for that param (if anything) is
 *     preserved as-is, since we have nothing to override it with.
 *   - The URL fragment (#...) is untouched and stays after the query
 *     string in the output, because URL.hash is independent of
 *     URL.search and both round-trip correctly through toString().
 *   - Values are percent-encoded automatically by URLSearchParams.
 *   - Path (including any trailing slash) is preserved exactly as given
 *     — URL parsing never normalizes it away.
 *
 * Throws if `baseUrl` isn't a valid absolute URL — callers are expected
 * to have already validated the destination URL (see
 * common/utils/url-validator.ts) before reaching this point.
 */
export function applyUtmParams(baseUrl: string, utm: UtmValues): string {
  const url = new URL(baseUrl);

  for (const field of Object.keys(UTM_FIELD_TO_PARAM) as UtmFieldName[]) {
    const value = utm[field];
    const paramName = UTM_FIELD_TO_PARAM[field];
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(paramName, value);
    }
  }

  return url.toString();
}

/** True if at least one UTM field has a non-empty value — used to skip
 * the URL-rewriting step entirely for the (common) case of a link with
 * no campaign/UTM configuration at all. */
export function hasAnyUtmValue(utm: UtmValues): boolean {
  return (Object.keys(UTM_FIELD_TO_PARAM) as UtmFieldName[]).some((field) => {
    const value = utm[field];
    return value !== undefined && value !== null && value !== '';
  });
}
