import { Injectable } from '@nestjs/common';
import { PlanLimitKey } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { PlanLimitExceededException } from './exceptions/plan-limit-exceeded.exception';
import type { PlanWithLimits } from './plans.service';
import {
  SubscriptionsService,
  type SubscriptionWithPlan,
} from './subscriptions.service';

export interface UsageSnapshot {
  key: PlanLimitKey;
  usage: number;
  /** null = unlimited. */
  limit: number | null;
  /** null = unlimited. */
  remaining: number | null;
  unlimited: boolean;
}

/** Keys reported by getUsage() — every metered/countable resource.
 * ANALYTICS_RETENTION_DAYS is deliberately excluded: it's a retention
 * *window*, not something a workspace "uses up", so it has no usage
 * count and isn't part of the dashboard's usage-bars section. */
const METERED_KEYS: PlanLimitKey[] = [
  PlanLimitKey.MAX_LINKS,
  PlanLimitKey.MAX_QR_CODES,
  PlanLimitKey.MAX_CAMPAIGNS,
  PlanLimitKey.MAX_CUSTOM_DOMAINS,
  PlanLimitKey.MAX_TEAM_MEMBERS,
  PlanLimitKey.MONTHLY_CLICKS,
  PlanLimitKey.MONTHLY_API_REQUESTS,
];

/**
 * Answers "can this workspace perform action X?" without any other
 * module needing to know a single numeric limit or which plan a
 * workspace is on. See docs/architecture/billing.md for the full
 * rationale behind each fallback rule exercised here:
 *
 *   - Unlimited plans:        PlanLimit.value === null       -> never blocks.
 *   - Zero limits:            PlanLimit.value === 0           -> always blocks (usage 0 + amount 1 > 0).
 *   - Exhausted limits:       usage + amount > limit           -> blocks.
 *   - Missing configuration:  no PlanLimit row for a key       -> treated as unlimited (fail-open).
 *   - Inactive subscriptions: effective status not on-plan     -> falls back to the FREE plan's limits.
 *   - Trial subscriptions:    TRIALING counts as "on-plan"     -> uses the plan being trialed.
 *
 * Deliberately never called from the redirect hot path — see
 * RedirectService, which has no dependency on this module at all.
 */
@Injectable()
export class BillingUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly audit: AuditService,
  ) {}

  async getLimit(
    workspaceId: string,
    key: PlanLimitKey,
  ): Promise<number | null> {
    const { plan } = await this.subscriptions.getEffectivePlan(workspaceId);
    return this.limitFromPlan(plan, key);
  }

  async canUse(
    workspaceId: string,
    key: PlanLimitKey,
    amount = 1,
  ): Promise<boolean> {
    const { plan, subscription } =
      await this.subscriptions.getEffectivePlan(workspaceId);
    const limit = this.limitFromPlan(plan, key);
    if (limit === null) return true;
    const usage = await this.usageFor(workspaceId, key, subscription);
    return usage + amount <= limit;
  }

  /**
   * The single call every limit-enforcement site uses (LinksService,
   * QrCodesService, CampaignsService, DomainsService,
   * WorkspacesService.inviteMember) — one query pass, throws
   * `PlanLimitExceededException` with the exact spec §10 error shape if
   * the workspace has no remaining capacity, otherwise resolves silently.
   * `featureLabel` is the human-readable name that ends up in the
   * exception body/message (e.g. "links", "team members").
   */
  async assertCanUse(
    workspaceId: string,
    key: PlanLimitKey,
    featureLabel: string,
    amount = 1,
  ): Promise<void> {
    const { plan, subscription } =
      await this.subscriptions.getEffectivePlan(workspaceId);
    const limit = this.limitFromPlan(plan, key);
    if (limit === null) return; // unlimited
    const usage = await this.usageFor(workspaceId, key, subscription);
    if (usage + amount > limit) {
      await this.audit.record({
        action: 'billing.limit_reached',
        entity: 'Subscription',
        workspaceId,
        metadata: { key, feature: featureLabel, limit, usage },
      });
      throw new PlanLimitExceededException(featureLabel, limit, usage);
    }
  }

  async getRemaining(
    workspaceId: string,
    key: PlanLimitKey,
  ): Promise<number | null> {
    const { plan, subscription } =
      await this.subscriptions.getEffectivePlan(workspaceId);
    const limit = this.limitFromPlan(plan, key);
    if (limit === null) return null;
    const usage = await this.usageFor(workspaceId, key, subscription);
    return Math.max(0, limit - usage);
  }

  /**
   * A single-pass (limit, usage) read with no opinion on what to do about
   * it — unlike assertCanUse, which throws billing's own
   * PlanLimitExceededException. Exists for callers outside the billing
   * domain that need to enforce a limit with their own error shape; today
   * that's only ApiUsageInterceptor (MONTHLY_API_REQUESTS), which throws
   * ApiPlanLimitExceededException instead. `limit: null` means unlimited.
   */
  async getUsageAndLimit(
    workspaceId: string,
    key: PlanLimitKey,
  ): Promise<{ limit: number | null; usage: number }> {
    const { plan, subscription } =
      await this.subscriptions.getEffectivePlan(workspaceId);
    const limit = this.limitFromPlan(plan, key);
    const usage = await this.usageFor(workspaceId, key, subscription);
    return { limit, usage };
  }

  async getUsage(workspaceId: string): Promise<UsageSnapshot[]> {
    const { plan, subscription } =
      await this.subscriptions.getEffectivePlan(workspaceId);

    return Promise.all(
      METERED_KEYS.map(async (key): Promise<UsageSnapshot> => {
        const limit = this.limitFromPlan(plan, key);
        const usage = await this.usageFor(workspaceId, key, subscription);
        return {
          key,
          usage,
          limit,
          remaining: limit === null ? null : Math.max(0, limit - usage),
          unlimited: limit === null,
        };
      }),
    );
  }

  private limitFromPlan(
    plan: PlanWithLimits,
    key: PlanLimitKey,
  ): number | null {
    const row = plan.limits.find((l) => l.key === key);
    // No row configured for this key -> unlimited (fail-open), not a
    // thrown error and not zero — see class docs.
    return row ? row.value : null;
  }

  private async usageFor(
    workspaceId: string,
    key: PlanLimitKey,
    subscription: SubscriptionWithPlan | null,
  ): Promise<number> {
    switch (key) {
      case PlanLimitKey.MAX_LINKS:
        return this.prisma.link.count({
          where: { workspaceId, deletedAt: null },
        });
      case PlanLimitKey.MAX_QR_CODES:
        return this.prisma.qrCode.count({
          where: { workspaceId, deletedAt: null },
        });
      case PlanLimitKey.MAX_CAMPAIGNS:
        return this.prisma.campaign.count({
          where: { workspaceId, deletedAt: null },
        });
      case PlanLimitKey.MAX_CUSTOM_DOMAINS:
        return this.prisma.customDomain.count({
          where: { workspaceId, deletedAt: null },
        });
      case PlanLimitKey.MAX_TEAM_MEMBERS:
        return this.prisma.workspaceMember.count({ where: { workspaceId } });
      case PlanLimitKey.MONTHLY_CLICKS:
        return this.monthlyClickUsage(workspaceId, subscription);
      case PlanLimitKey.MONTHLY_API_REQUESTS:
        return this.monthlyApiRequestUsage(workspaceId, subscription);
      case PlanLimitKey.ANALYTICS_RETENTION_DAYS:
        return 0;
      default:
        return 0;
    }
  }

  /**
   * Sums the existing Sprint 3 `LinkDailyStat` rollup over the current
   * billing period — no new click table, no duplicate counter. Clicks are
   * never blocked by this number (see LimitEnforcement docs on
   * BillingUsageService and RedirectService); it exists purely for the
   * dashboard's usage display.
   */
  private async monthlyClickUsage(
    workspaceId: string,
    subscription: SubscriptionWithPlan | null,
  ): Promise<number> {
    const { start, end } = this.resolveUsagePeriod(subscription);
    const result = await this.prisma.linkDailyStat.aggregate({
      _sum: { totalClicks: true },
      where: { workspaceId, date: { gte: start, lt: end } },
    });
    return result._sum.totalClicks ?? 0;
  }

  /**
   * Counts ApiUsageEvent rows (Sprint 8) over the current billing period
   * — same period-resolution helper as monthlyClickUsage, no separate
   * counting mechanism. Unlike clicks, this number IS enforced, but only
   * against API-key-authenticated requests — see
   * modules/api-keys/interceptors/api-usage.interceptor.ts, the only
   * caller that turns this into a block.
   */
  private async monthlyApiRequestUsage(
    workspaceId: string,
    subscription: SubscriptionWithPlan | null,
  ): Promise<number> {
    const { start, end } = this.resolveUsagePeriod(subscription);
    return this.prisma.apiUsageEvent.count({
      where: { workspaceId, createdAt: { gte: start, lt: end } },
    });
  }

  /** The subscription's own billing period when it has one; otherwise
   * calendar-month-to-date (FREE plans and workspaces with no
   * subscription row have no billing cycle of their own). */
  private resolveUsagePeriod(subscription: SubscriptionWithPlan | null): {
    start: Date;
    end: Date;
  } {
    if (subscription?.currentPeriodStart && subscription?.currentPeriodEnd) {
      return {
        start: subscription.currentPeriodStart,
        end: subscription.currentPeriodEnd,
      };
    }
    const now = new Date();
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    return { start, end };
  }
}
