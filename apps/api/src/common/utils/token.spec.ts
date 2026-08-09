import { generateOpaqueToken, hashToken } from './token';

describe('generateOpaqueToken', () => {
  it('generates a 64-character hex string (256 bits)', () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates a different token on every call', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
  });
});

describe('hashToken', () => {
  it('is deterministic for the same input', () => {
    const token = generateOpaqueToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('produces different hashes for different tokens', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(hashToken(a)).not.toBe(hashToken(b));
  });

  it('produces a 64-character hex SHA-256 digest', () => {
    expect(hashToken('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never returns the raw token unchanged', () => {
    const token = generateOpaqueToken();
    expect(hashToken(token)).not.toBe(token);
  });
});
