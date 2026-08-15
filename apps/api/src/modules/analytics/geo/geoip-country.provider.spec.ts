import { GeoipCountryProvider } from './geoip-country.provider';

/**
 * Exercises the REAL bundled geoip-country package (not mocked) — this
 * is the one place that actually proves the offline database is
 * loaded and returns sane results, rather than just asserting the
 * provider calls whatever mock a caller happens to supply (see
 * click-event.processor.spec.ts, which mocks GeoIpProvider entirely
 * and so never exercises this class at all).
 *
 * 8.8.8.8 / 2001:4860:4860::8888 (Google Public DNS) are used as
 * known-stable public IPs — Google's DNS service has been US-hosted
 * for a very long time and is about as safe a "this won't change
 * under us" assumption as a real-IP test can make.
 */
describe('GeoipCountryProvider', () => {
  let provider: GeoipCountryProvider;

  beforeEach(() => {
    provider = new GeoipCountryProvider();
  });

  describe('public IP lookups', () => {
    it('resolves a real public IPv4 address to a country', () => {
      const result = provider.lookup('8.8.8.8');
      expect(result.country).toBe('US');
    });

    it('resolves a real public IPv6 address to a country', () => {
      // geoip-country's underlying GeoLite2 data covers both IPv4 and
      // IPv6 ranges (see node_modules/geoip-country/README.md).
      const result = provider.lookup('2001:4860:4860::8888');
      expect(result.country).toBe('US');
    });
  });

  describe('loopback and private addresses — must report no data, never a fabricated country', () => {
    it('returns no geographic data for IPv4 loopback (127.0.0.1)', () => {
      const result = provider.lookup('127.0.0.1');
      expect(result).toEqual({ country: null, region: null, city: null });
    });

    it('returns no geographic data for IPv6 loopback (::1)', () => {
      const result = provider.lookup('::1');
      expect(result).toEqual({ country: null, region: null, city: null });
    });

    it('returns no geographic data for a private IPv4 address (RFC 1918)', () => {
      expect(provider.lookup('10.0.0.1').country).toBeNull();
      expect(provider.lookup('192.168.1.1').country).toBeNull();
      expect(provider.lookup('172.16.0.1').country).toBeNull();
    });
  });

  describe('malformed input — must never throw', () => {
    it('returns no geographic data for a non-IP string', () => {
      expect(() => provider.lookup('not-an-ip')).not.toThrow();
      expect(provider.lookup('not-an-ip')).toEqual({
        country: null,
        region: null,
        city: null,
      });
    });

    it('returns no geographic data for an empty string', () => {
      expect(provider.lookup('')).toEqual({
        country: null,
        region: null,
        city: null,
      });
    });

    it('returns no geographic data for an out-of-range address', () => {
      expect(provider.lookup('999.999.999.999')).toEqual({
        country: null,
        region: null,
        city: null,
      });
    });
  });

  describe('region and city are always null (country-only database, by design)', () => {
    it('never populates region/city even for a resolvable public IP', () => {
      const result = provider.lookup('8.8.8.8');
      expect(result.region).toBeNull();
      expect(result.city).toBeNull();
    });
  });

  describe('unavailable GeoIP data (package fails to load)', () => {
    it('degrades to reporting no geographic data for every lookup, without throwing', () => {
      jest.resetModules();
      jest.doMock('geoip-country', () => {
        throw new Error('simulated: geoip-country data file missing/corrupt');
      });

      // Re-require after mocking so the constructor's internal
      // require('geoip-country') call hits the mock above.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const {
        GeoipCountryProvider: ProviderWithBrokenDb,
      } = require('./geoip-country.provider');
      const brokenProvider = new ProviderWithBrokenDb();

      expect(() => brokenProvider.lookup('8.8.8.8')).not.toThrow();
      expect(brokenProvider.lookup('8.8.8.8')).toEqual({
        country: null,
        region: null,
        city: null,
      });

      jest.dontMock('geoip-country');
      jest.resetModules();
    });
  });
});
