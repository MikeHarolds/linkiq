'use client';

import type { CurrencyDto } from '@linkiq/types';
import * as React from 'react';

import {
  clearMyCurrencyPreference,
  getMyCurrencyPreference,
  setMyCurrencyPreference,
} from '@/lib/billing-api';
import { detectCurrency, getPublicCurrencies } from '@/lib/public-api';

import { useAuth } from './auth-provider';

const COOKIE_NAME = 'linkiq_currency';
const COOKIE_MAX_AGE_DAYS = 365;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1] ?? '') : null;
}

function writeCookie(name: string, value: string, days: number): void {
  if (typeof document === 'undefined') return;
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

interface CurrencyContextValue {
  /** The resolved, effective currency — null only until the very first
   * resolution completes (see isLoading). Never null-because-of-error:
   * a lookup failure always still ends at the platform fallback (see
   * CurrencyResolutionService's backend-side docs, mirrored here). */
  currency: CurrencyDto | null;
  currencies: CurrencyDto[];
  isLoading: boolean;
  /** Explicit selection — persists to a cookie for anonymous visitors,
   * and to the user's account when authenticated. Always wins over
   * IP-based detection from this point forward, on this device, until
   * changed again or cleared. */
  setCurrency: (code: string) => Promise<void>;
  /** Clears any explicit/persisted preference and re-resolves from
   * scratch (IP detection -> platform fallback). */
  clearCurrency: () => Promise<void>;
}

const CurrencyContext = React.createContext<CurrencyContextValue | null>(null);

/**
 * Sprint 16 — resolves "which currency applies right now" client-side,
 * merging the precedence chain across two sources because the backend's
 * @Public() /public/currencies/detect route structurally cannot see an
 * authenticated caller's identity (see PublicController's own docs —
 * @Public() routes never populate request.user, even with a valid
 * Bearer token attached):
 *   1. An explicit choice made THIS session (immediate, optimistic).
 *   2. The authenticated user's persisted preference (GET /users/me/
 *      currency-preference) — checked first when signed in, since it
 *      must win over a stale anonymous cookie from before login.
 *   3. An anonymous visitor's own persisted cookie, passed to
 *      /public/currencies/detect as the explicit param — the backend
 *      then only needs to do IP detection + fallback (steps 3-4 of
 *      Sprint 16 §6) for whichever of these two client-side steps
 *      didn't already resolve something.
 * Never blocks page rendering on failure — every branch below falls
 * through, ending at whatever /public/currencies/detect's own
 * fallback returns.
 */
export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [currencies, setCurrencies] = React.useState<CurrencyDto[]>([]);
  const [currency, setCurrencyState] = React.useState<CurrencyDto | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      try {
        const list = await getPublicCurrencies();
        if (cancelled) return;
        setCurrencies(list);

        if (isAuthenticated) {
          try {
            const pref = await getMyCurrencyPreference();
            if (cancelled) return;
            if (pref.currencyCode) {
              const match = list.find((c) => c.code === pref.currencyCode);
              if (match) {
                setCurrencyState(match);
                return;
              }
            }
          } catch {
            // Fall through to IP detection below — an unauthenticated-
            // looking failure here must never block the page.
          }
        }

        const cookieCode = readCookie(COOKIE_NAME) ?? undefined;
        const resolved = await detectCurrency(cookieCode);
        if (!cancelled) {
          setCurrencyState(resolved.currency);
        }
      } catch {
        // Never fail page rendering over currency detection (Sprint 16
        // §6) — leave `currency` null; every consumer already treats
        // null as "not resolved yet" rather than crashing.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const setCurrency = React.useCallback(
    async (code: string) => {
      writeCookie(COOKIE_NAME, code, COOKIE_MAX_AGE_DAYS);
      const match = currencies.find((c) => c.code === code);
      if (match) {
        setCurrencyState(match);
      }
      if (isAuthenticated) {
        try {
          await setMyCurrencyPreference(code);
        } catch {
          // The cookie + optimistic state update already applied —
          // failing to persist server-side shouldn't undo the user's
          // immediate selection.
        }
      }
    },
    [currencies, isAuthenticated],
  );

  const clearCurrency = React.useCallback(async () => {
    writeCookie(COOKIE_NAME, '', -1);
    if (isAuthenticated) {
      try {
        await clearMyCurrencyPreference();
      } catch {
        // ignore
      }
    }
    const resolved = await detectCurrency();
    setCurrencyState(resolved.currency);
  }, [isAuthenticated]);

  const value = React.useMemo(
    () => ({ currency, currencies, isLoading, setCurrency, clearCurrency }),
    [currency, currencies, isLoading, setCurrency, clearCurrency],
  );

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyContextValue {
  const ctx = React.useContext(CurrencyContext);
  if (!ctx) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return ctx;
}
