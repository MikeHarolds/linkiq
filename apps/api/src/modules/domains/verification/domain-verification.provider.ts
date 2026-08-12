import { randomBytes } from 'crypto';
import { resolveTxt } from 'dns/promises';

import { Injectable, Logger } from '@nestjs/common';

/** DI token — see domains.module.ts for which implementation is bound to
 * it (chosen via DOMAIN_VERIFICATION_MODE). */
export const DOMAIN_VERIFICATION_PROVIDER = 'DOMAIN_VERIFICATION_PROVIDER';

/**
 * Abstraction over "does this domain's DNS prove ownership". The only
 * seam a real DNS/registrar integration needs to plug into later —
 * nothing outside this file knows or cares which implementation is active.
 */
export interface DomainVerificationProvider {
  check(normalizedDomain: string, expectedToken: string): Promise<boolean>;
}

export function generateVerificationToken(): string {
  return `linkiq-verify-${randomBytes(16).toString('hex')}`;
}

/** The exact TXT record name a user is instructed to publish. */
export function verificationRecordName(normalizedDomain: string): string {
  return `_linkiq-verification.${normalizedDomain}`;
}

/**
 * Real DNS TXT lookup — no external provider API, no credentials, no
 * automated record creation. The user configures DNS manually; this only
 * reads it back. Never throws on lookup failure (NXDOMAIN, no records,
 * network error): all of those simply mean "not verified yet".
 */
@Injectable()
export class DnsTxtVerificationProvider implements DomainVerificationProvider {
  private readonly logger = new Logger(DnsTxtVerificationProvider.name);

  async check(
    normalizedDomain: string,
    expectedToken: string,
  ): Promise<boolean> {
    try {
      const records = await resolveTxt(
        verificationRecordName(normalizedDomain),
      );
      // Each TXT record can be split into multiple strings by DNS — join
      // before comparing, the same way most DNS-verification systems do.
      return records.some((chunks) => chunks.join('') === expectedToken);
    } catch (error) {
      this.logger.debug(
        `TXT lookup failed for ${normalizedDomain} (treated as not-yet-verified): ${String(error)}`,
      );
      return false;
    }
  }
}

/**
 * Deterministic, DNS-free verification for local development and
 * automated tests — selected automatically under NODE_ENV=test, or
 * explicitly via DOMAIN_VERIFICATION_MODE=mock. A domain verifies
 * successfully iff its normalized hostname starts with `verified-`;
 * every other hostname deterministically fails, so both the success and
 * failure paths are exercisable without any real DNS record existing.
 */
@Injectable()
export class MockVerificationProvider implements DomainVerificationProvider {
  async check(normalizedDomain: string): Promise<boolean> {
    return Promise.resolve(normalizedDomain.startsWith('verified-'));
  }
}
