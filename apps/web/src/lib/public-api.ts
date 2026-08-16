import type {
  CurrencyDto,
  DetectedCurrencyDto,
  PublicLandingPageContentDto,
  PublicPlanDto,
  PublicSiteConfigDto,
} from '@linkiq/types';

import { api } from './api-client';

/**
 * Unauthenticated, platform-level reads (Sprint 14) — backs the public
 * marketing landing page and the login/register pages' branding. Never
 * requires a session; safe to call before/without auth entirely (these
 * routes are @Public() server-side — see PublicController).
 */
export function getLandingPageContent(): Promise<PublicLandingPageContentDto> {
  return api.get('/public/landing-page');
}

export function getSiteConfig(): Promise<PublicSiteConfigDto> {
  return api.get('/public/site-config');
}

export function getPublicPlans(): Promise<PublicPlanDto[]> {
  return api.get('/public/plans');
}

/** Sprint 16 — the active currency catalogue, for any currency
 * selector (pricing page, dashboard). */
export function getPublicCurrencies(): Promise<CurrencyDto[]> {
  return api.get('/public/currencies');
}

/** Resolves the caller's currency (explicit choice > user preference >
 * IP detection > platform fallback — see CurrencyResolutionService).
 * Never persists anything itself. */
export function detectCurrency(explicitCode?: string): Promise<DetectedCurrencyDto> {
  const query = explicitCode ? `?currency=${encodeURIComponent(explicitCode)}` : '';
  return api.get(`/public/currencies/detect${query}`);
}
