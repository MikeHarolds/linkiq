import {
  normalizeDomain,
  normalizeHostHeader,
  validateDomainFormat,
} from './domain-normalization';

describe('normalizeDomain', () => {
  it('lowercases and trims', () => {
    expect(normalizeDomain('  Go.ACME.com  ')).toBe('go.acme.com');
  });

  it('strips a pasted protocol prefix', () => {
    expect(normalizeDomain('https://go.acme.com')).toBe('go.acme.com');
    expect(normalizeDomain('http://go.acme.com')).toBe('go.acme.com');
  });

  it('strips a trailing path', () => {
    expect(normalizeDomain('go.acme.com/some/path')).toBe('go.acme.com');
  });

  it('strips a trailing dot', () => {
    expect(normalizeDomain('go.acme.com.')).toBe('go.acme.com');
  });
});

describe('validateDomainFormat', () => {
  it('accepts a well-formed domain', () => {
    const result = validateDomainFormat('go.acme.com');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('go.acme.com');
  });

  it('accepts hyphenated labels', () => {
    expect(validateDomainFormat('my-links.acme-corp.com').valid).toBe(true);
  });

  it('rejects an empty domain', () => {
    expect(validateDomainFormat('   ').valid).toBe(false);
  });

  it('rejects a domain with no dot (not a local-dev hostname)', () => {
    const result = validateDomainFormat('acme');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/dot/);
  });

  it('accepts localhost and localhost subdomains without a dot requirement', () => {
    expect(validateDomainFormat('localhost').valid).toBe(true);
    expect(validateDomainFormat('branded.localhost').valid).toBe(true);
    expect(validateDomainFormat('branded.localtest').valid).toBe(true);
  });

  it('rejects whitespace inside the domain', () => {
    expect(validateDomainFormat('go acme.com').valid).toBe(false);
  });

  it('rejects invalid characters in a label', () => {
    expect(validateDomainFormat('go_acme!.com').valid).toBe(false);
  });

  it('rejects an empty label (double dot)', () => {
    expect(validateDomainFormat('go..acme.com').valid).toBe(false);
  });

  it('rejects a domain exceeding the max length', () => {
    const longLabel = 'a'.repeat(64);
    expect(validateDomainFormat(`${longLabel}.com`).valid).toBe(false);
  });

  it('tolerates a pasted protocol/path/trailing dot', () => {
    const result = validateDomainFormat('https://Go.Acme.com/path.');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('go.acme.com');
  });
});

describe('normalizeHostHeader', () => {
  it('returns undefined for an empty/missing header', () => {
    expect(normalizeHostHeader(undefined)).toBeUndefined();
    expect(normalizeHostHeader('')).toBeUndefined();
    expect(normalizeHostHeader('   ')).toBeUndefined();
  });

  it('lowercases and strips a port', () => {
    expect(normalizeHostHeader('Go.Acme.com:4000')).toBe('go.acme.com');
  });

  it('strips a trailing dot', () => {
    expect(normalizeHostHeader('go.acme.com.')).toBe('go.acme.com');
  });

  it('handles an IPv6 literal with a port', () => {
    expect(normalizeHostHeader('[::1]:4000')).toBe('::1');
  });

  it('handles a bare hostname with no port', () => {
    expect(normalizeHostHeader('localhost')).toBe('localhost');
  });
});
