import { resolveAttribution } from './attribution-resolver';

const DIRECT = { category: 'direct' as const, domain: null, url: null };
const REFERRAL = {
  category: 'referral' as const,
  domain: 'news.ycombinator.com',
  url: 'https://news.ycombinator.com/item?id=1',
};
const SOCIAL = {
  category: 'social' as const,
  domain: 'x.com',
  url: 'https://x.com/somepost',
};

describe('resolveAttribution', () => {
  it('a matched LinkSource always wins (tier 1), regardless of UTM or Referer', () => {
    const result = resolveAttribution(
      { id: 'src-1', source: 'whatsapp', medium: 'messaging', campaign: 'promo' },
      { utm_source: 'facebook', utm_medium: 'ignored' },
      SOCIAL,
    );
    expect(result).toEqual({
      linkSourceId: 'src-1',
      attributedSource: 'whatsapp',
      attributedMedium: 'messaging',
      attributedCampaign: 'promo',
      attributionType: 'campaign',
    });
  });

  it('no matched source, but utm_source present, beats a present Referer (tier 2 over tier 3)', () => {
    const result = resolveAttribution(
      null,
      { utm_source: 'newsletter', utm_medium: 'email' },
      SOCIAL,
    );
    expect(result).toEqual({
      linkSourceId: null,
      attributedSource: 'newsletter',
      attributedMedium: 'email',
      attributedCampaign: null,
      attributionType: 'utm',
    });
  });

  it('utm_source with no utm_medium/utm_campaign leaves those fields null, not undefined-crashing', () => {
    const result = resolveAttribution(null, { utm_source: 'newsletter' }, DIRECT);
    expect(result.attributedMedium).toBeNull();
    expect(result.attributedCampaign).toBeNull();
  });

  it('no source, no UTM, a Referer present — falls through to the classifier (tier 3)', () => {
    const result = resolveAttribution(null, null, REFERRAL);
    expect(result).toEqual({
      linkSourceId: null,
      attributedSource: 'news.ycombinator.com',
      attributedMedium: 'referral',
      attributedCampaign: null,
      attributionType: 'referrer',
    });
  });

  it('no source, no UTM, no Referer — Direct', () => {
    const result = resolveAttribution(null, null, DIRECT);
    expect(result).toEqual({
      linkSourceId: null,
      attributedSource: null,
      attributedMedium: null,
      attributedCampaign: null,
      attributionType: 'direct',
    });
  });

  it('an empty queryParams object with no utm_source falls through to Referer/Direct exactly like null', () => {
    const result = resolveAttribution(null, {}, DIRECT);
    expect(result.attributionType).toBe('direct');
  });
});
