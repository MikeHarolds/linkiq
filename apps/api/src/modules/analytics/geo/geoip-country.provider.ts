import { Injectable, Logger } from '@nestjs/common';
import type { CountryLookup } from 'geoip-country';

import type {
  GeoIpProvider,
  GeoLookupResult,
} from './geo-ip-provider.interface';
import { NO_GEO_DATA } from './geo-ip-provider.interface';

type GeoipModule = { lookup(ip: string): CountryLookup | null };

/**
 * Default GeoIpProvider: uses the bundled `geoip-country` package, a
 * ~8MB offline country-level database (no network calls, no API keys,
 * no per-request latency or cost). Deliberately country-only — region
 * and city are always null here. A deployment that needs finer-grained
 * geography swaps this provider for one backed by a full MaxMind
 * GeoIP2/GeoLite2 database or a hosted API; nothing else changes (see
 * the GeoIpProvider interface).
 */
@Injectable()
export class GeoipCountryProvider implements GeoIpProvider {
  private readonly logger = new Logger(GeoipCountryProvider.name);
  private readonly geoip: GeoipModule | null;

  constructor() {
    try {
      // Deliberately a runtime require (not a static top-level import) so
      // a missing/corrupt data file fails gracefully here, inside a
      // try/catch, instead of crashing the whole app at module-load time.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.geoip = require('geoip-country') as GeoipModule;
    } catch (error) {
      this.logger.warn(
        `geoip-country failed to load — geographic analytics will report "Unknown". ${String(error)}`,
      );
      this.geoip = null;
    }
  }

  lookup(ipAddress: string): GeoLookupResult {
    if (!this.geoip) {
      return NO_GEO_DATA;
    }

    try {
      const result = this.geoip.lookup(ipAddress);
      if (!result) {
        return NO_GEO_DATA;
      }
      return {
        country: result.country ?? null,
        region: null,
        city: null,
      };
    } catch (error) {
      this.logger.warn(
        `Geo lookup failed for an IP — treating as Unknown. ${String(error)}`,
      );
      return NO_GEO_DATA;
    }
  }
}
