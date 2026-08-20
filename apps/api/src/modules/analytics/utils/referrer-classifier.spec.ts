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

  describe('Facebook domains and subdomains', () => {
    it('classifies the bare apex domain as social', () => {
      const result = classifyReferrer('https://facebook.com/somepost');
      expect(result.category).toBe('social');
      expect(result.domain).toBe('facebook.com');
    });

    it('classifies www.facebook.com as social, normalized to the apex domain', () => {
      const result = classifyReferrer('https://www.facebook.com/somepost');
      expect(result.category).toBe('social');
      expect(result.domain).toBe('facebook.com');
    });

    it('classifies m.facebook.com (mobile site) as social', () => {
      const result = classifyReferrer('https://m.facebook.com/somepost');
      expect(result.category).toBe('social');
      expect(result.domain).toBe('m.facebook.com');
    });

    it('classifies l.facebook.com (link-shim redirector) as social', () => {
      const result = classifyReferrer(
        'https://l.facebook.com/l.php?u=https://example.com',
      );
      expect(result.category).toBe('social');
      expect(result.domain).toBe('l.facebook.com');
    });

    it('classifies lm.facebook.com as social', () => {
      const result = classifyReferrer('https://lm.facebook.com/somepost');
      expect(result.category).toBe('social');
      expect(result.domain).toBe('lm.facebook.com');
    });

    it('does NOT classify an unrelated facebook-lookalike subdomain as social', () => {
      // Guards the "explicit list, not generic subdomain stripping"
      // design choice: only the specific known Facebook hosts above are
      // social — anything else under facebook.com still resolves via
      // the normal referral fallback, not a blanket subdomain match.
      const result = classifyReferrer('https://developers.facebook.com/docs');
      expect(result.category).toBe('referral');
      expect(result.domain).toBe('developers.facebook.com');
    });
  });

  describe('WhatsApp', () => {
    it('classifies whatsapp.com as social', () => {
      const result = classifyReferrer('https://whatsapp.com/');
      expect(result.category).toBe('social');
      expect(result.domain).toBe('whatsapp.com');
    });

    it('classifies www.whatsapp.com as social, normalized to the apex domain', () => {
      const result = classifyReferrer('https://www.whatsapp.com/');
      expect(result.category).toBe('social');
      expect(result.domain).toBe('whatsapp.com');
    });

    it('classifies web.whatsapp.com (WhatsApp Web) as social', () => {
      const result = classifyReferrer('https://web.whatsapp.com/');
      expect(result.category).toBe('social');
      expect(result.domain).toBe('web.whatsapp.com');
    });
  });

  describe('YouTube', () => {
    it('classifies youtube.com as social', () => {
      const result = classifyReferrer('https://youtube.com/watch?v=abc');
      expect(result.category).toBe('social');
      expect(result.domain).toBe('youtube.com');
    });

    it('classifies www.youtube.com as social, normalized to the apex domain', () => {
      const result = classifyReferrer('https://www.youtube.com/watch?v=abc');
      expect(result.category).toBe('social');
      expect(result.domain).toBe('youtube.com');
    });

    it('classifies the youtu.be short domain as social', () => {
      const result = classifyReferrer('https://youtu.be/abc123');
      expect(result.category).toBe('social');
      expect(result.domain).toBe('youtu.be');
    });
  });

  it('classifies every other previously-supported social/search domain unchanged', () => {
    const cases: Array<[string, 'search' | 'social']> = [
      ['https://www.google.com/search?q=x', 'search'],
      ['https://bing.com/search?q=x', 'search'],
      ['https://www.instagram.com/p/abc', 'social'],
      ['https://www.linkedin.com/feed/', 'social'],
      ['https://x.com/someone/status/1', 'social'],
      ['https://twitter.com/someone/status/1', 'social'],
      ['https://www.tiktok.com/@someone/video/1', 'social'],
      ['https://www.reddit.com/r/test/', 'social'],
      ['https://www.pinterest.com/pin/1', 'social'],
      ['https://www.threads.net/@someone', 'social'],
    ];
    for (const [referrer, expected] of cases) {
      expect(classifyReferrer(referrer).category).toBe(expected);
    }
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
