import { registerAs } from '@nestjs/config';

export default registerAs('webhooks', () => ({
  /**
   * Encrypts/decrypts webhook signing secrets at rest (see
   * modules/webhooks/security/webhook-secret-cipher.service.ts). Must be
   * set to a real secret in production; the dev fallback below is
   * intentionally not a secret.
   */
  secretEncryptionKey:
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY ??
    'linkiq-dev-webhook-secret-key-change-in-production',

  /** Per-attempt HTTP timeout for outbound webhook deliveries. */
  timeoutMs: Number(process.env.WEBHOOK_TIMEOUT_MS ?? 10000),

  /** BullMQ `attempts` for automatic retries (includes the first try). */
  maxAttempts: Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 5),

  /** BullMQ exponential backoff base delay, in milliseconds. */
  backoffBaseMs: Number(process.env.WEBHOOK_BACKOFF_BASE_MS ?? 1000),

  /** Consecutive terminal-delivery failures before an endpoint is auto-disabled. */
  autoDisableThreshold: Number(
    process.env.WEBHOOK_AUTO_DISABLE_THRESHOLD ?? 10,
  ),

  /**
   * Narrow dev/test exception (see security/webhook-url-guard.ts): only
   * ever exempts `http:` URLs that resolve exclusively to loopback
   * addresses. Every other private/reserved range stays blocked
   * regardless of this flag, in every environment.
   */
  allowHttpLocalhost: process.env.WEBHOOK_ALLOW_HTTP_LOCALHOST === 'true',
}));
