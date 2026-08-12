import { Module } from '@nestjs/common';

import { DomainCacheService } from './domain-cache.service';
import { DomainResolverService } from './domain-resolver.service';
import { DomainsController } from './domains.controller';
import { DomainsService } from './domains.service';
import { PublicUrlService } from './public-url.service';
import {
  DnsTxtVerificationProvider,
  DOMAIN_VERIFICATION_PROVIDER,
  MockVerificationProvider,
} from './verification/domain-verification.provider';

/**
 * Custom Domains & Branded Link Infrastructure (Sprint 6).
 *
 * Exports DomainResolverService (hostname -> workspace resolution, used
 * by LinksModule's redirect pipeline) and PublicUrlService (link ->
 * public URL, used by LinksModule and QrCodesModule) so both modules can
 * import DomainsModule without either module needing to depend on the
 * other — DomainsModule itself depends on nothing from Links or QrCodes.
 *
 * DOMAIN_VERIFICATION_PROVIDER is selected once here based on
 * DOMAIN_VERIFICATION_MODE (default "dns"; "mock", or NODE_ENV=test,
 * selects the deterministic provider used by e2e tests and local dev
 * without real DNS) — this is the one place a future real DNS-provider
 * integration would be wired in.
 */
@Module({
  controllers: [DomainsController],
  providers: [
    DomainsService,
    DomainResolverService,
    DomainCacheService,
    PublicUrlService,
    DnsTxtVerificationProvider,
    MockVerificationProvider,
    {
      provide: DOMAIN_VERIFICATION_PROVIDER,
      useFactory: (
        dns: DnsTxtVerificationProvider,
        mock: MockVerificationProvider,
      ) => {
        const mode = process.env.DOMAIN_VERIFICATION_MODE ?? 'dns';
        return mode === 'mock' || process.env.NODE_ENV === 'test' ? mock : dns;
      },
      inject: [DnsTxtVerificationProvider, MockVerificationProvider],
    },
  ],
  exports: [DomainsService, DomainResolverService, PublicUrlService],
})
export class DomainsModule {}
