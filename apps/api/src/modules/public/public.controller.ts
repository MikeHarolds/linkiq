import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { PlansService, type PlanWithLimits } from '../billing/plans.service';
import { BrandingService } from '../branding/branding.service';
import { LandingPageService, type PublicLandingPageContent } from '../landing-page/landing-page.service';

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
}

function toPublicPlan(plan: PlanWithLimits): PublicPlan {
  // Deliberately omits providerPlanId (Paystack plan_code — an
  // internal billing-wiring detail, not something a visitor needs)
  // and isActive (this list is already filtered to active-only by
  // PlansService.listActive) — never the raw Plan/PlanLimit rows.
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
  ) {}

  @Public()
  @Get('landing-page')
  @ApiOperation({ summary: 'Active landing-page content, for the public marketing site' })
  async getLandingPage(): Promise<PublicLandingPageContent> {
    return this.landingPage.getPublicContent();
  }

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'Active, publicly purchasable plans, for the marketing pricing section' })
  async getPlans(): Promise<PublicPlan[]> {
    const active = await this.plans.listActive();
    return active.map(toPublicPlan);
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
}
