import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Currency } from '@prisma/client';

import {
  GEO_IP_PROVIDER,
  type GeoIpProvider,
} from '../analytics/geo/geo-ip-provider.interface';
import { PrismaService } from '../prisma/prisma.service';

import { CurrencyService } from './currency.service';

export type CurrencyResolutionSource =
  | 'EXPLICIT'
  | 'USER_PREFERENCE'
  | 'IP_DETECTED'
  | 'FALLBACK';

export interface ResolveCurrencyInput {
  /** A currency the caller explicitly asked for right now (a query
   * param, a selector on the pricing page) — always wins when valid.
   * Never persisted here; a distinct explicit "save this preference"
   * action (UsersController) is what changes USER_PREFERENCE. */
  explicitCurrencyCode?: string;
  /** An authenticated user's id, to check their persisted preference —
   * omitted entirely for anonymous requests (the frontend carries the
   * anonymous preference itself, via a client-side cookie — see
   * Sprint 16 §7; there is nothing for the backend to look up for a
   * visitor with no account). */
  userId?: string;
  /** The caller's IP, already resolved via the shared
   * extractClientIp()/@Ctx() — never re-derived here. Undefined/
   * unresolvable is handled the same as any other lookup miss. */
  ipAddress?: string;
}

export interface ResolvedCurrency {
  currency: Currency;
  source: CurrencyResolutionSource;
  detectedCountry: string | null;
}

/**
 * Single source of truth for "which currency applies right now" —
 * mirrors RoleResolutionService's role (Sprint 15): every caller that
 * needs a currency (public pricing, checkout, the currency-detect
 * endpoint) goes through here rather than re-implementing the
 * precedence chain. Precedence (Sprint 16 §6, never reordered):
 *   1. Explicit selection for this request
 *   2. The authenticated user's persisted preference
 *   3. IP/GeoIP-detected country -> currency
 *   4. The platform fallback currency
 * Never throws for a bad/missing IP, unknown country, or GeoIP
 * failure — every one of those is treated as "no signal," falling
 * through to the next step, ending at the fallback currency, which
 * CurrencyService guarantees always exists and is active.
 */
@Injectable()
export class CurrencyResolutionService {
  private readonly logger = new Logger(CurrencyResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly currencies: CurrencyService,
    @Inject(GEO_IP_PROVIDER) private readonly geoProvider: GeoIpProvider,
  ) {}

  async resolve(input: ResolveCurrencyInput): Promise<ResolvedCurrency> {
    const settings = await this.currencies.getSettings();

    if (input.explicitCurrencyCode) {
      const explicit = await this.tryGetActiveCurrencyByCode(input.explicitCurrencyCode);
      if (explicit) {
        return { currency: explicit, source: 'EXPLICIT', detectedCountry: null };
      }
      this.logger.debug(
        `Explicit currency "${input.explicitCurrencyCode}" is unknown or inactive — falling through`,
      );
    }

    if (input.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { preferredCurrency: true },
      });
      if (user?.preferredCurrency?.isActive) {
        return { currency: user.preferredCurrency, source: 'USER_PREFERENCE', detectedCountry: null };
      }
    }

    let detectedCountry: string | null = null;
    if (settings.autoDetectEnabled && input.ipAddress) {
      try {
        const geo = this.geoProvider.lookup(input.ipAddress);
        detectedCountry = geo.country;
        if (geo.country) {
          const currency = await this.currencies.findCurrencyForCountry(geo.country);
          if (currency) {
            return { currency, source: 'IP_DETECTED', detectedCountry };
          }
        }
      } catch (error) {
        // GeoIpProvider.lookup already never throws, but this endpoint
        // must never fail page rendering over currency detection
        // regardless (Sprint 16 §6) — defense in depth.
        this.logger.warn(`Currency IP-detection failed unexpectedly — using fallback. ${String(error)}`);
      }
    }

    return { currency: settings.fallbackCurrency, source: 'FALLBACK', detectedCountry };
  }

  private async tryGetActiveCurrencyByCode(code: string): Promise<Currency | null> {
    const currency = await this.prisma.currency.findUnique({ where: { code: code.toUpperCase() } });
    return currency?.isActive ? currency : null;
  }
}
