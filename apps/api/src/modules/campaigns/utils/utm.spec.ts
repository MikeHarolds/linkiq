import {
  applyUtmParams,
  hasAnyUtmValue,
  validateUtmValue,
  validateUtmValues,
} from './utm';

describe('validateUtmValue', () => {
  it('accepts free-text campaign-name-shaped values', () => {
    expect(validateUtmValue('Summer Sale 2026').valid).toBe(true);
    expect(validateUtmValue('facebook').valid).toBe(true);
    expect(validateUtmValue('cpc').valid).toBe(true);
    expect(validateUtmValue('summer_campaign_2026').valid).toBe(true);
    expect(validateUtmValue('promo-code-50').valid).toBe(true);
  });

  it('rejects an empty value', () => {
    expect(validateUtmValue('').valid).toBe(false);
  });

  it('rejects a value exceeding the max length', () => {
    expect(validateUtmValue('a'.repeat(256)).valid).toBe(false);
    expect(validateUtmValue('a'.repeat(255)).valid).toBe(true);
  });

  it('rejects control characters', () => {
    expect(validateUtmValue('value\x00withnull').valid).toBe(false);
    expect(validateUtmValue('value\nwithnewline').valid).toBe(false);
  });

  it('rejects obviously dangerous content', () => {
    expect(validateUtmValue('<script>alert(1)</script>').valid).toBe(false);
    expect(validateUtmValue('javascript:alert(1)').valid).toBe(false);
  });
});

describe('validateUtmValues', () => {
  it('accepts an object with only some fields set', () => {
    expect(
      validateUtmValues({ utmSource: 'facebook', utmMedium: 'social' }).valid,
    ).toBe(true);
  });

  it('accepts an entirely empty object', () => {
    expect(validateUtmValues({}).valid).toBe(true);
  });

  it('ignores null/undefined fields but validates present ones', () => {
    const result = validateUtmValues({
      utmSource: 'facebook',
      utmMedium: undefined,
      utmCampaign: null,
      utmTerm: '<script>bad</script>',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('utm_term');
  });
});

describe('applyUtmParams', () => {
  it('appends UTM params to a URL with no existing query string', () => {
    const result = applyUtmParams('https://example.com/product', {
      utmSource: 'facebook',
      utmMedium: 'social',
    });
    expect(result).toBe(
      'https://example.com/product?utm_source=facebook&utm_medium=social',
    );
  });

  it('preserves existing query parameters (the exact example from the spec)', () => {
    const result = applyUtmParams('https://example.com/product?id=123', {
      utmSource: 'facebook',
      utmMedium: 'social',
    });
    const url = new URL(result);
    expect(url.searchParams.get('id')).toBe('123');
    expect(url.searchParams.get('utm_source')).toBe('facebook');
    expect(url.searchParams.get('utm_medium')).toBe('social');
  });

  it('does not duplicate a UTM parameter already present in the base URL — it replaces it', () => {
    const result = applyUtmParams('https://example.com/?utm_source=old-value', {
      utmSource: 'new-value',
    });
    const url = new URL(result);
    expect(url.searchParams.getAll('utm_source')).toEqual(['new-value']);
  });

  it('leaves an existing UTM param untouched when we have no value for it', () => {
    const result = applyUtmParams(
      'https://example.com/?utm_source=manually-set',
      {
        utmMedium: 'social',
      },
    );
    const url = new URL(result);
    expect(url.searchParams.get('utm_source')).toBe('manually-set');
    expect(url.searchParams.get('utm_medium')).toBe('social');
  });

  it('preserves non-UTM parameters exactly, including ones with special characters', () => {
    const result = applyUtmParams(
      'https://example.com/search?q=hello+world&category=a%26b',
      {
        utmSource: 'x',
      },
    );
    const url = new URL(result);
    expect(url.searchParams.get('q')).toBe('hello world');
    expect(url.searchParams.get('category')).toBe('a&b');
  });

  it('preserves a URL fragment, keeping it after the query string', () => {
    const result = applyUtmParams('https://example.com/page#section-2', {
      utmSource: 'newsletter',
    });
    expect(result).toBe(
      'https://example.com/page?utm_source=newsletter#section-2',
    );
  });

  it('preserves a fragment alongside an existing query string', () => {
    const result = applyUtmParams('https://example.com/page?id=1#top', {
      utmSource: 'x',
    });
    const url = new URL(result);
    expect(url.hash).toBe('#top');
    expect(url.searchParams.get('id')).toBe('1');
    expect(url.searchParams.get('utm_source')).toBe('x');
  });

  it('preserves a trailing slash', () => {
    const result = applyUtmParams('https://example.com/products/', {
      utmSource: 'x',
    });
    expect(result.startsWith('https://example.com/products/?')).toBe(true);
  });

  it('preserves the exact path when there is no trailing slash', () => {
    const result = applyUtmParams('https://example.com/products', {
      utmSource: 'x',
    });
    expect(result.startsWith('https://example.com/products?')).toBe(true);
  });

  it('percent-encodes values containing spaces and special characters', () => {
    const result = applyUtmParams('https://example.com/', {
      utmCampaign: 'Summer Sale 2026 & More!',
    });
    const url = new URL(result);
    expect(url.searchParams.get('utm_campaign')).toBe(
      'Summer Sale 2026 & More!',
    );
    // Confirm it's actually encoded in the raw string, not left as a raw space.
    expect(result).not.toContain(' ');
  });

  it('applies all five UTM fields correctly together', () => {
    const result = applyUtmParams('https://example.com/', {
      utmSource: 'newsletter',
      utmMedium: 'email',
      utmCampaign: 'spring_launch',
      utmTerm: 'running+shoes',
      utmContent: 'header_cta',
    });
    const url = new URL(result);
    expect(url.searchParams.get('utm_source')).toBe('newsletter');
    expect(url.searchParams.get('utm_medium')).toBe('email');
    expect(url.searchParams.get('utm_campaign')).toBe('spring_launch');
    expect(url.searchParams.get('utm_term')).toBe('running+shoes');
    expect(url.searchParams.get('utm_content')).toBe('header_cta');
  });

  it('treats an empty string the same as absent (does not set an empty param)', () => {
    const result = applyUtmParams('https://example.com/', { utmSource: '' });
    expect(result).toBe('https://example.com/');
  });

  it('returns the base URL unchanged when no UTM values are given', () => {
    const result = applyUtmParams('https://example.com/product?id=123', {});
    expect(result).toBe('https://example.com/product?id=123');
  });

  it('throws for an invalid base URL', () => {
    expect(() =>
      applyUtmParams('not-a-valid-url', { utmSource: 'x' }),
    ).toThrow();
  });
});

describe('hasAnyUtmValue', () => {
  it('returns false for an empty object', () => {
    expect(hasAnyUtmValue({})).toBe(false);
  });

  it('returns false when all fields are null/undefined/empty', () => {
    expect(
      hasAnyUtmValue({
        utmSource: null,
        utmMedium: undefined,
        utmCampaign: '',
      }),
    ).toBe(false);
  });

  it('returns true when at least one field has a value', () => {
    expect(hasAnyUtmValue({ utmSource: 'facebook' })).toBe(true);
  });
});
