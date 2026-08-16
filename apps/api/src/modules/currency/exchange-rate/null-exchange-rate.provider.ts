import { Injectable } from '@nestjs/common';

import type {
  ExchangeRateLookupResult,
  ExchangeRateProvider,
} from './exchange-rate-provider.interface';

/**
 * The default (and, this sprint, only) ExchangeRateProvider — always
 * reports "no rate available." No external exchange-rate service is
 * currently used anywhere in this project (see Sprint 16 §10: "do not
 * add a paid external exchange-rate service unless the existing
 * project already uses one" — it doesn't), so this is not a stub
 * awaiting a follow-up sprint; it is the architecturally correct
 * binding today. Fixed, currency-specific PlanPrice rows never call
 * this at all — only PlansService's optional "convert from base
 * currency" path does, and it degrades to "conversion unavailable,
 * configure a fixed price instead" exactly as designed.
 */
@Injectable()
export class NullExchangeRateProvider implements ExchangeRateProvider {
  async getRate(_base: string, _target: string): Promise<ExchangeRateLookupResult | null> {
    return null;
  }
}
