import {
  classifyReferrer,
  extractMarketingParams,
} from './referrer-classifier';

describe('classifyReferrer', () => {
  it('classifies missing/empty referrer as direct', () => {
    expect(classifyReferrer(undefined)).toEqual({
      category: 'direct',
      domain: null,
      url: null,
    });
    expect(classifyReferrer(null)).toEqual({
      category: 'direct',
      domain: null,
      url: null,
    });
    expect(classifyReferrer('')).toEqual({
      category: 'direct',
      domain: null,
      url: null,
    });
    expect(classifyReferrer('   ')).toEqual({
      category: 'direct',
      domain: null,
      url: null,
    });
  });

  it('classifies known search engines', () => {
    expect(classifyReferrer('https://www.google.com/search?q=x').category).toBe(
      'search',
    );
    expect(classifyReferrer('https://bing.com/search?q=x').category).toBe(
      'search',
    );
    expect(classifyReferrer('https://duckduckgo.com/?q=x').category).toBe(
      'search',
    );
  });

  it('classifies known social platforms', () => {
    expect(classifyReferrer('https://www.facebook.com/').category).toBe(
      'social',
    );
    expect(classifyReferrer('https://x.com/someone').category).toBe('social');
    expect(classifyReferrer('https://t.co/abc123').category).toBe('social');
  });

  it('classifies an unrecognized external domain as referral, not "other"', () => {
    const result = classifyReferrer('https://some-blog.example.com/post');
    expect(result.category).toBe('referral');
    expect(result.domain).toBe('some-blog.example.com');
  });

  it('classifies a malformed referrer URL as other, not direct', () => {
    const result = classifyReferrer('not a valid url');
    expect(result.category).toBe('other');
    expect(result.domain).toBeNull();
  });

  it('strips a leading www. for domain matching', () => {
    expect(classifyReferrer('https://www.google.com/').domain).toBe(
      'google.com',
    );
  });

  it('is case-insensitive for domain matching', () => {
    expect(classifyReferrer('https://WWW.GOOGLE.COM/').category).toBe('search');
  });
});

describe('extractMarketingParams', () => {
  it('returns null when there is no query string', () => {
    expect(extractMarketingParams(undefined)).toBeNull();
    expect(extractMarketingParams('')).toBeNull();
  });

  it('extracts recognized utm_ params', () => {
    const result = extractMarketingParams(
      'utm_source=newsletter&utm_medium=email',
    );
    expect(result).toEqual({ utm_source: 'newsletter', utm_medium: 'email' });
  });

  it('returns null when no recognized params are present', () => {
    expect(extractMarketingParams('foo=bar&baz=qux')).toBeNull();
  });

  it('does NOT capture arbitrary/unrecognized query params (privacy boundary)', () => {
    const result = extractMarketingParams(
      'utm_source=x&email=someone@example.com&token=secret123',
    );
    expect(result).toEqual({ utm_source: 'x' });
    expect(JSON.stringify(result)).not.toContain('someone@example.com');
    expect(JSON.stringify(result)).not.toContain('secret123');
  });

  it('truncates overly long param values', () => {
    const longValue = 'a'.repeat(500);
    const result = extractMarketingParams(`utm_source=${longValue}`);
    expect(result?.utm_source?.length).toBe(255);
  });
});
