import { Module } from '@nestjs/common';

import { GEO_IP_PROVIDER } from '../analytics/geo/geo-ip-provider.interface';
import { GeoipCountryProvider } from '../analytics/geo/geoip-country.provider';
import { NullGeoIpProvider } from '../analytics/geo/null-geo.provider';

import { CurrencyResolutionService } from './currency-resolution.service';
import { CurrencyService } from './currency.service';
import { EXCHANGE_RATE_PROVIDER } from './exchange-rate/exchange-rate-provider.interface';
import { ExchangeRateService } from './exchange-rate/exchange-rate.service';
import { NullExchangeRateProvider } from './exchange-rate/null-exchange-rate.provider';

/**
 * Sprint 16 — currency catalogue, country mapping, platform settings,
 * currency resolution, and the exchange-rate abstraction. Deliberately
 * depends only on PrismaService/AuditService (both @Global(), no
 * explicit import needed) — never on BillingModule, even though
 * checkout ultimately needs both a currency AND a provider-support
 * check, to avoid a BillingModule -> CurrencyModule -> BillingModule
 * cycle (BillingModule imports this module; see RolesModule for the
 * identical precedent from Sprint 15). Provider-currency-capability
 * checks happen one layer up, in SubscriptionsService/BillingController,
 * which already have both this module and BILLING_PROVIDER available.
 *
 * GEO_IP_PROVIDER is re-registered here (not imported from
 * AnalyticsModule) purely to avoid pulling AnalyticsModule's own
 * WebhooksModule -> BillingModule edge into this chain — the
 * *implementation* (GeoipCountryProvider) is still the exact same
 * class AnalyticsModule uses, imported directly, not reimplemented; see
 * docs/architecture/currency.md for why a second DI binding of a
 * stateless, dependency-free class was chosen over a circular import.
 */
@Module({
  providers: [
    CurrencyService,
    CurrencyResolutionService,
    ExchangeRateService,
    {
      provide: GEO_IP_PROVIDER,
      useClass: process.env.GEO_IP_PROVIDER === 'none' ? NullGeoIpProvider : GeoipCountryProvider,
    },
    {
      provide: EXCHANGE_RATE_PROVIDER,
      useClass: NullExchangeRateProvider,
    },
  ],
  exports: [CurrencyService, CurrencyResolutionService, ExchangeRateService],
})
export class CurrencyModule {}
