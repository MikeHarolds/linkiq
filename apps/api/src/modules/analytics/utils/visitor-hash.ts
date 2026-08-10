import { createHash } from 'crypto';

/**
 * Computes a privacy-safe, deterministic "unique visitor" identifier.
 *
 * Design: SHA-256(salt : ipAddress : userAgent : utcDayKey). The raw IP
 * address is only ever used transiently, as an input to this hash — it is
 * never persisted anywhere (see ClickEvent, which has no ipAddress column).
 *
 * Why include the day key: including the calendar day means the same
 * visitor gets a DIFFERENT hash each day. This is a deliberate trade-off,
 * not an oversight — it means we cannot track a visitor's behavior across
 * days even in aggregate, which is a meaningfully stronger privacy
 * property than a stable long-lived fingerprint, at the cost of slightly
 * overcounting multi-day "unique" visitors (someone who clicks the same
 * link on two different days counts as two unique visitors, not one).
 * That trade-off is intentional for a link-shortener's analytics, where
 * "engaged visitors per day" is the meaningful metric, not long-term
 * cross-session identity tracking.
 *
 * Limitations (worth documenting plainly):
 *   - Same visitor, different IP (e.g. switching wifi/cellular) counts twice.
 *   - Different visitors behind the same NAT/IP with an identical UA count once.
 *   - A visitor clicking the same link on consecutive days is two "uniques".
 * This is the same class of approximation every cookie-less analytics
 * approach makes; it's a reasonable engineering trade-off for "roughly how
 * many distinct people," not a legal or forensic identifier.
 */
export function computeVisitorHash(
  ipAddress: string,
  userAgent: string,
  occurredAt: Date,
  salt: string,
): string {
  const dayKey = occurredAt.toISOString().slice(0, 10); // UTC YYYY-MM-DD
  return createHash('sha256')
    .update(`${salt}:${ipAddress}:${userAgent}:${dayKey}`)
    .digest('hex');
}
