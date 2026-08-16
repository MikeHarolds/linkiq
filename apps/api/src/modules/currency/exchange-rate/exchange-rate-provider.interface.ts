export interface ExchangeRateLookupResult {
  rate: number;
  /** When this rate was captured — never re-derived after the fact, so
   * a converted PlanPrice/Invoice can record exactly which rate/moment
   * produced its amount (see Sprint 16 §10/§13). */
  timestamp: Date;
  /** Free-text identifying which provider produced the rate (e.g.
   * "fixed-config", a real vendor's name once one exists) — never a
   * secret, safe to store and display in the admin UI. */
  source: string;
}

/**
 * Abstraction over "base currency, target currency -> exchange rate".
 * Deliberately not tied to any vendor — mirrors
 * analytics/geo/geo-ip-provider.interface.ts's shape exactly (a small
 * lookup interface, a null-object default, a swappable DI token) so a
 * real paid provider can be added later purely as a new implementation
 * of this interface, with zero changes to ExchangeRateService or any
 * caller. See ExchangeRateService's own docs for why NullExchangeRate
 * Provider (this sprint's only implementation) is not a placeholder to
 * "finish later" — fixed, currency-specific PlanPrice rows are fully
 * functional with no exchange-rate provider configured at all.
 */
export interface ExchangeRateProvider {
  /** Never throws — returns null when no rate is available (no
   * provider configured, unknown currency pair, provider error), so a
   * missing rate never breaks plan pricing or checkout. */
  getRate(base: string, target: string): Promise<ExchangeRateLookupResult | null>;
}

export const EXCHANGE_RATE_PROVIDER = 'EXCHANGE_RATE_PROVIDER';
