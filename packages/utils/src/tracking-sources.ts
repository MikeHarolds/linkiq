/**
 * Central definition of LinkIQ's predefined tracking sources (Explicit
 * Link Source / Campaign Attribution) — imported by both apps/api (for
 * server-side normalization/default-medium lookup) and apps/web (for
 * the source dropdown), so this list exists exactly once, not scattered
 * across the two apps.
 *
 * `key` is the normalized value stored on LinkSource.source and placed
 * in the generated tracking URL's utm_source — always lowercase,
 * matching how apps/api's normalizeSourceKey() normalizes incoming
 * utm_source values before comparison.
 */
export interface PredefinedTrackingSource {
  key: string;
  label: string;
  /** Pre-filled into the Medium field at creation time — always
   * user-overridable, never enforced server-side. */
  defaultMedium: string;
}

export const PREDEFINED_TRACKING_SOURCES: readonly PredefinedTrackingSource[] =
  [
    { key: 'facebook', label: 'Facebook', defaultMedium: 'social' },
    { key: 'instagram', label: 'Instagram', defaultMedium: 'social' },
    { key: 'whatsapp', label: 'WhatsApp', defaultMedium: 'messaging' },
    { key: 'tiktok', label: 'TikTok', defaultMedium: 'social' },
    { key: 'google', label: 'Google', defaultMedium: 'search' },
    { key: 'youtube', label: 'YouTube', defaultMedium: 'social' },
    { key: 'linkedin', label: 'LinkedIn', defaultMedium: 'social' },
    { key: 'email', label: 'Email', defaultMedium: 'email' },
    { key: 'sms', label: 'SMS', defaultMedium: 'messaging' },
    { key: 'telegram', label: 'Telegram', defaultMedium: 'messaging' },
  ];

/** Not a member of PREDEFINED_TRACKING_SOURCES itself — selecting it in
 * the UI reveals a free-text key input instead of using this key
 * literally as the source. */
export const CUSTOM_TRACKING_SOURCE_KEY = 'custom';

export function findPredefinedTrackingSource(
  key: string,
): PredefinedTrackingSource | undefined {
  const normalized = key.trim().toLowerCase();
  return PREDEFINED_TRACKING_SOURCES.find((s) => s.key === normalized);
}
