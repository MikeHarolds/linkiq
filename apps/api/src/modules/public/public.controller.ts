import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import {
  Ctx,
  type RequestContext,
} from '../../common/decorators/request-context.decorator';
import { PlansService, type PlanWithLimits } from '../billing/plans.service';
import { BrandingService } from '../branding/branding.service';
import { CurrencyResolutionService } from '../currency/currency-resolution.service';
import { CurrencyService } from '../currency/currency.service';
import {
  LandingPageService,
  type PublicLandingPageContent,
} from '../landing-page/landing-page.service';

export interface PublicSiteConfig {
  siteName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
}

export interface PublicPlan {
  id: string;
  name: string;
  slug: string;
  tier: string;
  description: string | null;
  priceAmount: number;
  currency: string;
  billingInterval: string;
  trialDays: number | null;
  displayOrder: number;
  limits: Array<{ key: string; value: number | null }>;
  /** Sprint 16 — additional currency-specific prices, for the pricing
   * page's currency selector (see CurrencyResolutionService). */
  prices: Array<{ currencyCode: string; amount: number }>;
}

function toPublicPlan(plan: PlanWithLimits): PublicPlan {
  // Deliberately omits providerPlanId (Paystack plan_code — an
  // internal billing-wiring detail, not something a visitor needs),
  // isActive, and isFeaturedOnHomepage/homepageOrder (this list is
  // already filtered to active+featured by
  // PlansService.listFeaturedForHomepage) — never the raw Plan/
  // PlanLimit rows.
  return {
    id: plan.id,
    name: plan.name,
    slug: plan.slug,
    tier: plan.tier,
    description: plan.description,
    priceAmount: plan.priceAmount,
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    trialDays: plan.trialDays,
    displayOrder: plan.displayOrder,
    limits: plan.limits.map((l) => ({ key: l.key, value: l.value })),
    prices: plan.prices.map((p) => ({
      currencyCode: p.currency.code,
      amount: p.amount,
    })),
  };
}

/**
 * Unauthenticated, platform-level read endpoints (Sprint 14) — the
 * marketing landing page, the login page, and the registration page
 * all read from here. Deliberately never depends on the authenticated
 * user (every route is @Public()) and never exposes anything beyond
 * what's declared on PublicSiteConfig/PublicLandingPageContent —
 * no admin data, no internal ids beyond what the content itself needs
 * to render, no credentials of any kind. Both backing services
 * (LandingPageService.getPublicContent, BrandingService.get) already
 * filter to active-only content and cache their result briefly, so a
 * traffic spike on the public site never turns into a database-per-
 * request problem — see each service's own docs.
 */
@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(
    private readonly landingPage: LandingPageService,
    private readonly branding: BrandingService,
    private readonly plans: PlansService,
    private readonly currencies: CurrencyService,
    private readonly currencyResolution: CurrencyResolutionService,
  ) {}

  @Public()
  @Get('landing-page')
  @ApiOperation({
    summary: 'Active landing-page content, for the public marketing site',
  })
  async getLandingPage(): Promise<PublicLandingPageContent> {
    return this.landingPage.getPublicContent();
  }

  @Public()
  @Get('plans')
  @ApiOperation({
    summary:
      'Active plans a Super Admin has marked featured, for the marketing pricing section',
    description:
      'Sprint 17 — a curated subset of listActive() (see PlansService.listFeaturedForHomepage). Never every purchasable plan: homepage curation is a distinct concern from what the authenticated dashboard billing page offers.',
  })
  async getPlans(): Promise<PublicPlan[]> {
    const featured = await this.plans.listFeaturedForHomepage();
    return featured.map(toPublicPlan);
  }

  @Public()
  @Get('site-config')
  @ApiOperation({ summary: 'Public site branding — name, logo, favicon' })
  async getSiteConfig(): Promise<PublicSiteConfig> {
    const branding = await this.branding.get();
    return {
      siteName: branding.siteName,
      logoUrl: branding.logoUrl,
      faviconUrl: branding.faviconUrl,
    };
  }

  @Public()
  @Get('currencies')
  @ApiOperation({
    summary: 'Active currency catalogue, for the currency selector',
  })
  async getCurrencies() {
    return this.currencies.listActive();
  }

  /**
   * Sprint 16 — read-only currency resolution for an anonymous or
   * authenticated visitor. Never persists anything itself (an explicit
   * user selection is saved via a separate PATCH on UsersController) —
   * see CurrencyResolutionService's own docs for the full precedence
   * chain. `explicit` lets the frontend re-resolve after a user picks a
   * currency from the selector without a page reload; `userId` is
   * intentionally NOT accepted as a query param (an anonymous caller
   * has no user to look up, and an authenticated one is identified via
   * their own session on the non-public /users/me endpoints instead —
   * this route never trusts a caller-supplied user id).
   */
  @Public()
  @Get('currencies/detect')
  @ApiOperation({
    summary:
      "Resolve the caller's currency from an explicit choice, then IP, then the platform fallback",
  })
  async detectCurrency(
    @Ctx() ctx: RequestContext,
    @Query('currency') explicit?: string,
  ) {
    const resolved = await this.currencyResolution.resolve({
      explicitCurrencyCode: explicit,
      ipAddress: ctx.ipAddress,
    });
    return {
      currency: resolved.currency,
      source: resolved.source,
      detectedCountry: resolved.detectedCountry,
    };
  }
}
