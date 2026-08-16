import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillingInterval,
  PlanTier,
  Prisma,
  type Currency,
  type Plan,
  type PlanLimit,
  type PlanLimitKey,
  type PlanPrice,
} from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { AuditService } from '../audit/audit.service';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';

export type PlanPriceWithCurrency = PlanPrice & { currency: Currency };

export type PlanWithLimits = Plan & {
  limits: PlanLimit[];
  platformRole: { id: string; name: string; slug: string } | null;
  /** Sprint 16 — additional currency-specific prices beyond the base
   * `currency`/`priceAmount` above; always present (possibly empty),
   * never a separate lookup callers have to remember to make. */
  prices: PlanPriceWithCurrency[];
};

const PLAN_WITH_LIMITS_INCLUDE = {
  limits: true,
  platformRole: { select: { id: true, name: true, slug: true } },
  prices: { include: { currency: true } },
} as const;

/** slug/tier ARE settable here, unlike UpdatePlanInput — they're only
 * immutable once a plan exists (see updateForAdmin's own docs). */
export interface CreatePlanInput {
  name: string;
  slug: string;
  tier: PlanTier;
  description?: string;
  priceAmount: number;
  currency?: string;
  billingInterval?: BillingInterval;
  trialDays?: number | null;
  isActive?: boolean;
  displayOrder?: number;
  providerPlanId?: string | null;
  limits?: Partial<Record<PlanLimitKey, number | null>>;
  /** Sprint 15 — see Plan.platformRoleId's own schema docs. */
  platformRoleId?: string | null;
}

/** Every field optional — Super Admin edits are partial updates against
 * whatever the plan already has. Deliberately does NOT invent defaults
 * for price/currency: omitted fields are left exactly as they are. */
export interface UpdatePlanInput {
  name?: string;
  description?: string | null;
  priceAmount?: number;
  currency?: string;
  billingInterval?: 'MONTHLY' | 'ANNUAL';
  trialDays?: number | null;
  isActive?: boolean;
  displayOrder?: number;
  providerPlanId?: string | null;
  /** Replaces the full limit set when provided — a partial map would be
   * ambiguous (does an omitted key mean "leave alone" or "remove"?); the
   * admin UI always submits every PlanLimitKey it displays. */
  limits?: Partial<Record<PlanLimitKey, number | null>>;
  platformRoleId?: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Plans are seed-managed data with no edit endpoint this sprint — a
 * short-lived in-memory cache (not Redis) avoids a database round trip on
 * every limit check without the operational weight of a distributed
 * cache for something that never changes at runtime. See
 * BillingUsageService, the main caller.
 */
@Injectable()
export class PlansService {
  private cache: { plans: PlanWithLimits[]; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly currencies: CurrencyService,
  ) {}

  async listActive(): Promise<PlanWithLimits[]> {
    const all = await this.getAllCached();
    return all
      .filter((plan) => plan.isActive)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async getBySlug(slug: string): Promise<PlanWithLimits> {
    const all = await this.getAllCached();
    const plan = all.find((p) => p.slug === slug);
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    return plan;
  }

  /** The fallback plan for a workspace whose subscription isn't
   * effectively active (expired trial, past cancellation date, no
   * subscription at all) — see BillingUsageService. Throws only if the
   * database has no FREE-tier plan configured at all, which is a seed
   * misconfiguration, not a per-workspace condition. */
  async getFreePlan(): Promise<PlanWithLimits> {
    const all = await this.getAllCached();
    const plan = all
      .filter((p) => p.tier === PlanTier.FREE)
      .sort((a, b) => a.displayOrder - b.displayOrder)[0];
    if (!plan) {
      throw new NotFoundException(
        'No FREE plan is configured — run the seed script',
      );
    }
    return plan;
  }

  /** Super Admin visibility (Sprint 11) — unlike listActive(), includes
   * inactive plans, since an admin managing the plan catalog needs to
   * see everything, not just what's currently purchasable. */
  async listAllForAdmin(): Promise<PlanWithLimits[]> {
    const all = await this.getAllCached();
    return [...all].sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async getByIdOrThrow(planId: string): Promise<PlanWithLimits> {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      include: PLAN_WITH_LIMITS_INCLUDE,
    });
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    return plan;
  }

  /**
   * Super Admin plan creation (Sprint 14). Deliberately does NOT talk
   * to any BillingProvider — that would create a circular dependency
   * (PaystackBillingProvider already depends on PlansService for
   * checkout's plan lookup). Provider-side sync, when requested, is
   * orchestrated one layer up by AdminPlansController, which injects
   * BILLING_PROVIDER directly and — on success — calls updateForAdmin
   * to persist the resulting providerPlanId, reusing that existing
   * write path rather than adding a second one here.
   */
  async create(
    input: CreatePlanInput,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<PlanWithLimits> {
    const existing = await this.prisma.plan.findUnique({ where: { slug: input.slug } });
    if (existing) {
      throw new ConflictException(`A plan with slug "${input.slug}" already exists`);
    }
    if (input.platformRoleId) {
      await this.assertValidPlanRole(input.platformRoleId);
    }

    const plan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.plan.create({
        data: {
          name: input.name,
          slug: input.slug,
          tier: input.tier,
          description: input.description,
          priceAmount: input.priceAmount,
          currency: input.currency ?? 'USD',
          billingInterval: input.billingInterval ?? BillingInterval.MONTHLY,
          trialDays: input.trialDays,
          isActive: input.isActive ?? true,
          displayOrder: input.displayOrder ?? 0,
          providerPlanId: input.providerPlanId,
          platformRoleId: input.platformRoleId,
        },
      });

      if (input.limits) {
        for (const [key, value] of Object.entries(input.limits)) {
          await tx.planLimit.create({
            data: { planId: created.id, key: key as PlanLimitKey, value },
          });
        }
      }

      return created;
    });

    this.cache = null;
    await this.audit.record({
      action: 'admin.plan_created',
      entity: 'Plan',
      entityId: plan.id,
      userId: adminUserId,
      metadata: { slug: plan.slug, name: plan.name, tier: plan.tier },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.getByIdOrThrow(plan.id);
  }

  /**
   * Super Admin plan editing (Sprint 11) — the first write path this
   * service has ever had. Deliberately does not touch `slug`/`tier`
   * (identity fields other code keys off of — e.g.
   * SubscriptionsService.subscribe looks plans up by slug) or create/
   * delete a Plan outright; only updates an existing seeded row's
   * editable fields. Every call is audited, and the in-memory cache is
   * invalidated immediately so the change is visible on the very next
   * read anywhere in the app (limit checks, checkout, this admin UI).
   */
  async updateForAdmin(
    planId: string,
    input: UpdatePlanInput,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<PlanWithLimits> {
    const existing = await this.getByIdOrThrow(planId);
    if (input.platformRoleId) {
      await this.assertValidPlanRole(input.platformRoleId);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.plan.update({
        where: { id: planId },
        data: {
          name: input.name,
          description: input.description,
          priceAmount: input.priceAmount,
          currency: input.currency,
          billingInterval: input.billingInterval,
          trialDays: input.trialDays,
          isActive: input.isActive,
          displayOrder: input.displayOrder,
          providerPlanId: input.providerPlanId,
          platformRoleId: input.platformRoleId,
        },
      });

      if (input.limits) {
        for (const [key, value] of Object.entries(input.limits)) {
          await tx.planLimit.upsert({
            where: { planId_key: { planId, key: key as PlanLimitKey } },
            create: { planId, key: key as PlanLimitKey, value },
            update: { value },
          });
        }
      }
    });

    this.cache = null;

    await this.audit.record({
      action: 'admin.plan_updated',
      entity: 'Plan',
      entityId: planId,
      userId: adminUserId,
      metadata: JSON.parse(
        JSON.stringify({ slug: existing.slug, changes: input }),
      ) as Prisma.InputJsonValue,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.getByIdOrThrow(planId);
  }

  /** Sprint 15 — a plan's role must exist and be active. There is no
   * "must not be SUPER_ADMIN" check needed here: PlatformRole is a
   * completely separate table from the GlobalRole enum, so a plan can
   * never reference SUPER_ADMIN even by accident — see
   * docs/architecture/roles-and-permissions.md. */
  private async assertValidPlanRole(platformRoleId: string): Promise<void> {
    const role = await this.prisma.platformRole.findUnique({ where: { id: platformRoleId } });
    if (!role) {
      throw new NotFoundException('Selected role not found');
    }
    if (!role.isActive) {
      throw new BadRequestException('Cannot attach an inactive role to a plan');
    }
  }

  /**
   * Sprint 16 — sets (creates or replaces) this plan's price in a
   * specific currency. Deliberately upsert-by-(planId, currencyId)
   * rather than separate create/update methods with different id
   * shapes: the admin UI always addresses a price by which currency
   * it's for, never by the PlanPrice row's own id (see AdminPlansController).
   * `isConverted`/`exchangeRate*` are set here only when the caller
   * actually used ExchangeRateService.convert() to derive `amount` —
   * see AdminPlansController's own docs for that flow; a directly-typed
   * fixed price always has isConverted: false.
   */
  async setPrice(
    planId: string,
    input: {
      currencyId: string;
      amount: number;
      isConverted?: boolean;
      exchangeRate?: number | null;
      exchangeRateAsOf?: Date | null;
      providerPlanId?: string | null;
    },
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<PlanWithLimits> {
    const plan = await this.getByIdOrThrow(planId);
    const currency = await this.currencies.getByIdOrThrow(input.currencyId);
    if (!currency.isActive) {
      throw new BadRequestException('Cannot set a plan price in an inactive currency');
    }

    const existing = plan.prices.find((p) => p.currencyId === input.currencyId);

    await this.prisma.planPrice.upsert({
      where: { planId_currencyId: { planId, currencyId: input.currencyId } },
      create: {
        planId,
        currencyId: input.currencyId,
        amount: input.amount,
        isConverted: input.isConverted ?? false,
        exchangeRate: input.exchangeRate,
        exchangeRateAsOf: input.exchangeRateAsOf,
        providerPlanId: input.providerPlanId,
      },
      update: {
        amount: input.amount,
        isConverted: input.isConverted ?? false,
        exchangeRate: input.exchangeRate,
        exchangeRateAsOf: input.exchangeRateAsOf,
        providerPlanId: input.providerPlanId,
      },
    });

    this.cache = null;

    await this.audit.record({
      action: existing ? 'admin.plan_price_updated' : 'admin.plan_price_created',
      entity: 'PlanPrice',
      entityId: planId,
      userId: adminUserId,
      metadata: {
        planSlug: plan.slug,
        currencyCode: currency.code,
        amount: input.amount,
        previousAmount: existing?.amount ?? null,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.getByIdOrThrow(planId);
  }

  async removePrice(
    planId: string,
    currencyId: string,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<PlanWithLimits> {
    const plan = await this.getByIdOrThrow(planId);
    const price = plan.prices.find((p) => p.currencyId === currencyId);
    if (!price) {
      throw new NotFoundException('No price configured for this plan in that currency');
    }

    await this.prisma.planPrice.delete({ where: { id: price.id } });
    this.cache = null;

    await this.audit.record({
      action: 'admin.plan_price_removed',
      entity: 'PlanPrice',
      entityId: planId,
      userId: adminUserId,
      metadata: { planSlug: plan.slug, currencyCode: price.currency.code },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.getByIdOrThrow(planId);
  }

  private async getAllCached(): Promise<PlanWithLimits[]> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.plans;
    }
    const plans = await this.prisma.plan.findMany({
      include: PLAN_WITH_LIMITS_INCLUDE,
      orderBy: { displayOrder: 'asc' },
    });
    this.cache = { plans, expiresAt: now + CACHE_TTL_MS };
    return plans;
  }
}
