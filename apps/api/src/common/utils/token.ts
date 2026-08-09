import { createHash, randomBytes } from 'crypto';

/** Generates a high-entropy, URL-safe opaque token (256 bits). */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Deterministic SHA-256 hash for opaque, high-entropy tokens (refresh
 * tokens, password-reset tokens). This is NOT for passwords — passwords
 * use bcrypt (see AuthService). SHA-256 is appropriate here because these
 * tokens are already 256 bits of random data (not guessable/brute-forceable
 * the way a human password is), and we need fast, deterministic equality
 * lookups by hash, which a salted bcrypt hash cannot provide.
 */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
