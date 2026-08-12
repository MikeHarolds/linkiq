import { Injectable } from '@nestjs/common';
import { DomainStatus } from '@prisma/client';

const DEFAULT_APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

export interface PublicUrlDomain {
  normalizedDomain: string;
  status: DomainStatus;
}

/**
 * The single source of truth for "what URL does a link's shortCode
 * resolve at". Used by link responses, QR code generation, and anywhere
 * else a link's public URL needs to be shown — see qr-codes.service.ts
 * and links.service.ts, which previously each built this string inline
 * against a hardcoded APP_URL.
 */
@Injectable()
export class PublicUrlService {
  build(shortCode: string, customDomain?: PublicUrlDomain | null): string {
    if (customDomain && customDomain.status === DomainStatus.ACTIVE) {
      return `https://${customDomain.normalizedDomain}/${shortCode}`;
    }
    return `${DEFAULT_APP_URL}/${shortCode}`;
  }
}
