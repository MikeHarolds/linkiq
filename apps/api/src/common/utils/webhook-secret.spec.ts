import { generateWebhookSecret } from './webhook-secret';

describe('generateWebhookSecret', () => {
  it('produces a secret starting with the whsec_ prefix', () => {
    const { rawSecret } = generateWebhookSecret();
    expect(rawSecret.startsWith('whsec_')).toBe(true);
  });

  it('generates a different secret on every call', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a.rawSecret).not.toBe(b.rawSecret);
  });

  it('has sufficient entropy in the secret portion (no short/predictable ids)', () => {
    const { rawSecret } = generateWebhookSecret();
    const secret = rawSecret.slice('whsec_'.length);
    // 24 random bytes base64url-encoded is 32 characters, never a UUID or timestamp.
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it('secretPrefix is a short, non-secret slice of the raw secret', () => {
    const { rawSecret, secretPrefix } = generateWebhookSecret();
    expect(rawSecret.startsWith(secretPrefix)).toBe(true);
    expect(secretPrefix.length).toBeLessThan(rawSecret.length);
  });

  it('does not return a hash field — the secret must remain reversible', () => {
    const generated = generateWebhookSecret();
    expect(generated).not.toHaveProperty('secretHash');
    expect(Object.keys(generated).sort()).toEqual(['rawSecret', 'secretPrefix']);
  });
});
