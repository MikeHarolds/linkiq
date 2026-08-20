/**
 * Normalizes a tracking source's `source` value (predefined key or a
 * user-typed "Custom" key) to the exact form stored on LinkSource.source
 * and compared against the incoming utm_source at click time — see
 * ClickEventProcessor. Trim + lowercase only; validity/length/content
 * safety is enforced separately via campaigns/utils/utm.ts's
 * validateUtmValue, reused rather than duplicated here.
 */
export function normalizeSourceKey(value: string): string {
  return value.trim().toLowerCase();
}
