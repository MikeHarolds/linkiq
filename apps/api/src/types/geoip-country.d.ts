/**
 * geoip-country ships no TypeScript declarations of its own. This
 * declares only the surface LinkIQ actually uses.
 */
declare module 'geoip-country' {
  export interface CountryLookup {
    country: string;
    continent?: string;
  }

  export function lookup(ipAddress: string): CountryLookup | null;
}
