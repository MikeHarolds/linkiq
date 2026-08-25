import { registerAs } from '@nestjs/config';

export default registerAs('email', () => ({
  /**
   * Encrypts/decrypts Resend API keys and SMTP passwords at rest (see
   * modules/email/security/email-secret-cipher.service.ts) — same
   * AES-256-GCM shape as WEBHOOK_SECRET_ENCRYPTION_KEY, its own,
   * independent key. Must be set to a real secret in production; the
   * dev fallback below is intentionally not a secret.
   */
  secretEncryptionKey:
    process.env.EMAIL_SECRET_ENCRYPTION_KEY ??
    'linkiq-dev-email-secret-key-change-in-production',

  /** BullMQ `attempts` for automatic retries (includes the first try). */
  maxAttempts: Number(process.env.EMAIL_MAX_ATTEMPTS ?? 5),

  /** BullMQ exponential backoff base delay, in milliseconds. */
  backoffBaseMs: Number(process.env.EMAIL_BACKOFF_BASE_MS ?? 2000),

  /** Per-attempt timeout for outbound Resend/SMTP calls. */
  timeoutMs: Number(process.env.EMAIL_TIMEOUT_MS ?? 10000),

  /**
   * Recommended zero-admin-setup demo path (§18/§19): if all three are
   * present, prisma/seed.ts pre-populates and enables EmailConfiguration
   * with them so a fresh Render deploy has working email with no
   * admin-UI interaction. Never read anywhere outside the seed script —
   * once EmailConfiguration exists, it (not these env vars) is the
   * single source of truth, editable from /admin/settings/email.
   */
  resendApiKey: process.env.RESEND_API_KEY,
  resendFromEmail: process.env.RESEND_FROM_EMAIL,
  resendFromName: process.env.RESEND_FROM_NAME,
}));
