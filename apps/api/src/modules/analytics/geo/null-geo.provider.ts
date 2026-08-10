import { Injectable } from '@nestjs/common';

import type {
  GeoIpProvider,
  GeoLookupResult,
} from './geo-ip-provider.interface';
import { NO_GEO_DATA } from './geo-ip-provider.interface';

/** Always reports "Unknown". Useful for privacy-strict deployments that
 * don't want any geo resolution at all, or as a safe default if no other
 * provider is configured. */
@Injectable()
export class NullGeoIpProvider implements GeoIpProvider {
  lookup(_ipAddress: string): GeoLookupResult {
    return NO_GEO_DATA;
  }
}
