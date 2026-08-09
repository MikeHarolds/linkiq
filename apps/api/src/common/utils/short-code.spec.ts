import { generateShortCode, validateCustomSlug } from './short-code';

describe('generateShortCode', () => {
  it('generates a 7-character code by default', () => {
    expect(generateShortCode()).toHaveLength(7);
  });

  it('generates only base62 characters', () => {
    const code = generateShortCode();
    expect(code).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('generates different codes across calls (collision-resistant)', () => {
    const codes = new Set(
      Array.from({ length: 50 }, () => generateShortCode()),
    );
    // Astronomically unlikely to collide at 7 base62 chars across 50 draws;
    // a failure here would indicate a real randomness bug, not bad luck.
    expect(codes.size).toBe(50);
  });

  it('respects a custom length', () => {
    expect(generateShortCode(10)).toHaveLength(10);
  });
});

describe('validateCustomSlug', () => {
  it('accepts a valid slug', () => {
    expect(validateCustomSlug('summer-sale').valid).toBe(true);
    expect(validateCustomSlug('promo_2026').valid).toBe(true);
    expect(validateCustomSlug('abc123').valid).toBe(true);
  });

  it('rejects a slug that is too short', () => {
    const result = validateCustomSlug('ab');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/at least/i);
  });

  it('rejects a slug that is too long', () => {
    const result = validateCustomSlug('a'.repeat(51));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/at most/i);
  });

  it('rejects invalid characters', () => {
    expect(validateCustomSlug('has spaces').valid).toBe(false);
    expect(validateCustomSlug('has/slash').valid).toBe(false);
    expect(validateCustomSlug('has.dot').valid).toBe(false);
    expect(validateCustomSlug('emoji😀slug').valid).toBe(false);
  });

  it.each(['api', 'admin', 'login', 'dashboard', 'health', 'links', 'AUTH'])(
    'rejects the reserved slug "%s" (case-insensitive)',
    (reserved) => {
      const result = validateCustomSlug(reserved);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/reserved/i);
    },
  );

  it('accepts a slug that merely contains a reserved word as a substring', () => {
    // Reserved-word matching is exact, not substring — "apiary" must not
    // be rejected just because it starts with "api".
    expect(validateCustomSlug('apiary-tours').valid).toBe(true);
  });
});
