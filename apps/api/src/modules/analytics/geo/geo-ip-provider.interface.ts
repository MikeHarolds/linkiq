export interface GeoLookupResult {
  country: string | null;
  region: string | null;
  city: string | null;
}

export const NO_GEO_DATA: GeoLookupResult = {
  country: null,
  region: null,
  city: null,
};

/**
 * Abstraction over "IP address -> approximate location". Deliberately not
 * tied to any specific vendor — see geoip-country.provider.ts (the
 * default, bundled implementation) and null.provider.ts (the fallback).
 * Swap in a different implementation (a paid MaxMind GeoIP2 database, a
 * hosted API, ...) by providing a different class under this same token
 * in analytics.module.ts; nothing else in the codebase needs to change.
 */
export interface GeoIpProvider {
  /** Never throws — returns NO_GEO_DATA (all-null) for any IP it can't
   * resolve, so a lookup failure never breaks event processing. */
  lookup(ipAddress: string): GeoLookupResult;
}

export const GEO_IP_PROVIDER = 'GEO_IP_PROVIDER';
