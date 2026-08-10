import { registerAs } from '@nestjs/config';

export default registerAs('analytics', () => ({
  /**
   * Salts the visitor-hash computation (see analytics/utils/visitor-hash.ts).
   * Rotating this value changes every future visitor hash — existing
   * historical events are unaffected since their hashes were already
   * computed and stored. Must be set in production; the dev fallback
   * below is intentionally not a secret.
   */
  visitorHashSalt:
    process.env.VISITOR_HASH_SALT ?? 'linkiq-dev-salt-change-in-production',
}));
