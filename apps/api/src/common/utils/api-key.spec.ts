import { generateApiKey, looksLikeApiKey } from './api-key';
import { hashToken } from './token';

describe('generateApiKey', () => {
  it('produces a key starting with the lk_live_ prefix', () => {
    const { rawKey } = generateApiKey();
    expect(rawKey.startsWith('lk_live_')).toBe(true);
  });

  it('generates a different key on every call', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.rawKey).not.toBe(b.rawKey);
  });

  it('has sufficient entropy in the secret portion (no short/predictable ids)', () => {
    const { rawKey } = generateApiKey();
    const secret = rawKey.slice('lk_live_'.length);
    // 24 random bytes base64url-encoded is 32 characters, never a UUID or timestamp.
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it('keyPrefix is a short, non-secret slice of the raw key', () => {
    const { rawKey, keyPrefix } = generateApiKey();
    expect(rawKey.startsWith(keyPrefix)).toBe(true);
    expect(keyPrefix.length).toBeLessThan(rawKey.length);
  });

  it('keyHash is the sha256 of the full raw key, not the prefix alone', () => {
    const { rawKey, keyHash } = generateApiKey();
    expect(keyHash).toBe(hashToken(rawKey));
  });

  it('never returns the raw key as the hash', () => {
    const { rawKey, keyHash } = generateApiKey();
    expect(keyHash).not.toBe(rawKey);
  });
});

describe('looksLikeApiKey', () => {
  it('recognizes a well-formed API key', () => {
    expect(looksLikeApiKey('lk_live_abc123')).toBe(true);
  });

  it('rejects a JWT-shaped bearer token', () => {
    expect(looksLikeApiKey('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc')).toBe(
      false,
    );
  });

  it('rejects an empty string', () => {
    expect(looksLikeApiKey('')).toBe(false);
  });
});
