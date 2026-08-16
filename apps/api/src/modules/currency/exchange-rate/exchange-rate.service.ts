import { Inject, Injectable } from '@nestjs/common';

import {
  EXCHANGE_RATE_PROVIDER,
  type ExchangeRateProvider,
} from './exchange-rate-provider.interface';

export interface ConversionResult {
  amount: number;
  rate: number;
  timestamp: Date;
  source: string;
}

/**
 * Thin wrapper PlansService/AdminCurrenciesController talk to instead
 * of the raw ExchangeRateProvider token directly — never hardwires a
 * vendor (see ExchangeRateProvider's own docs). `convert` rounds to the
 * nearest minor unit (never a fractional cent/kobo), matching the
 * existing "amounts are always integer minor units" convention
 * Plan.priceAmount/Invoice.amount already use.
 */
@Injectable()
export class ExchangeRateService {
  constructor(
    @Inject(EXCHANGE_RATE_PROVIDER)
    private readonly provider: ExchangeRateProvider,
  ) {}

  async getRate(
    base: string,
    target: string,
  ): Promise<{ rate: number; timestamp: Date; source: string } | null> {
    if (base === target) {
      return { rate: 1, timestamp: new Date(), source: 'identity' };
    }
    return this.provider.getRate(base, target);
  }

  /** Returns null when no rate is available — callers must fall back to
   * a fixed price or reject the operation with a clear message, never
   * silently charge an unconverted amount in the wrong currency. */
  async convert(
    amountMinorUnits: number,
    base: string,
    target: string,
  ): Promise<ConversionResult | null> {
    const result = await this.getRate(base, target);
    if (!result) {
      return null;
    }
    return {
      amount: Math.round(amountMinorUnits * result.rate),
      rate: result.rate,
      timestamp: result.timestamp,
      source: result.source,
    };
  }
}
