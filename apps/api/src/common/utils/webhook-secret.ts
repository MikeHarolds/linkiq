import { randomBytes } from 'crypto';

/**
 * LinkIQ webhook signing secret format: `whsec_<192 bits of random,
 * URL-safe data>` — same generation approach as common/utils/api-key.ts's
 * `lk_live_` format. Unlike an API key, this secret is never hashed for
 * storage — see modules/webhooks/security/webhook-secret-cipher.service.ts
 * for why it's encrypted (reversibly) instead, and why that's a
 * deliberately different choice from Sprint 8's API keys.
 */
const WEBHOOK_SECRET_PREFIX = 'whsec_';
const PREFIX_DISPLAY_CHARS = 8;

export interface GeneratedWebhookSecret {
  /** The full secret — returned to the caller exactly once. */
  rawSecret: string;
  /** Safe to persist and display; cannot be used to sign anything. */
  secretPrefix: string;
}

export function generateWebhookSecret(): GeneratedWebhookSecret {
  const secret = randomBytes(24).toString('base64url'); // 192 bits
  const rawSecret = `${WEBHOOK_SECRET_PREFIX}${secret}`;
  return {
    rawSecret,
    secretPrefix: rawSecret.slice(
      0,
      WEBHOOK_SECRET_PREFIX.length + PREFIX_DISPLAY_CHARS,
    ),
  };
}
