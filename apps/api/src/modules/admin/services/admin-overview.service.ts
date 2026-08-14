import { Injectable } from '@nestjs/common';
import {
  BillingInterval,
  InvoiceStatus,
  SubscriptionStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface PlatformOverview {
  users: { total: number; active: number };
  workspaces: { total: number };
  links: { active: number };
  clicks: { inRange: number };
  subscriptions: { active: number; trialing: number; pastDue: number };
  /** Monthly Recurring Revenue, in cents — sum over every currently
   * ACTIVE subscription's plan price, ANNUAL plans divided by 12. A
   * genuine calculation from real Plan/Subscription rows, not an
   * invented figure; mixed-currency plans are summed as-is (see
   * `note`) since this platform has no currency-conversion mechanism. */
  mrr: { amount: number; currency: string | null; note: string | null };
  revenue: { collectedInRange: number; currency: string | null };
  paymentFailures: { inRange: number };
  apiRequests: { inRange: number };
  webhookFailures: { inRange: number };
  domains: { total: number; active: number };
}

/**
 * Platform-level metrics for /admin (Sprint 11 — Super Admin). Every
 * number here is a direct, real aggregate query against existing tables
 * — nothing is estimated, cached, or duplicated into a new counter
 * table. Where a metric can't be calculated reliably from existing data
 * (e.g. true multi-currency MRR conversion), it's flagged via `note`
 * rather than silently producing a misleading single number.
 */
@Injectable()
export class AdminOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(from: Date, to: Date): Promise<PlatformOverview> {
    const [
      totalUsers,
      activeUsers,
      totalWorkspaces,
      activeLinks,
      clicksInRange,
      activeSubs,
      trialingSubs,
      pastDueSubs,
      activeSubscriptionPlans,
      revenueInRange,
      paymentFailuresInRange,
      apiRequestsInRange,
      webhookFailuresInRange,
      totalDomains,
      activeDomains,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.workspace.count(),
      this.prisma.link.count({ where: { status: 'ACTIVE' } }),
      this.prisma.clickEvent.count({
        where: { occurredAt: { gte: from, lte: to } },
      }),
      this.prisma.subscription.count({
        where: { status: SubscriptionStatus.ACTIVE },
      }),
      this.prisma.subscription.count({
        where: { status: SubscriptionStatus.TRIALING },
      }),
      this.prisma.subscription.count({
        where: { status: SubscriptionStatus.PAST_DUE },
      }),
      this.prisma.subscription.findMany({
        where: { status: SubscriptionStatus.ACTIVE },
        select: {
          plan: {
            select: {
              priceAmount: true,
              currency: true,
              billingInterval: true,
            },
          },
        },
      }),
      this.prisma.invoice.aggregate({
        where: { status: InvoiceStatus.PAID, paidAt: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
      this.prisma.invoice.count({
        where: {
          status: InvoiceStatus.UNCOLLECTIBLE,
          issueDate: { gte: from, lte: to },
        },
      }),
      this.prisma.apiUsageEvent.count({
        where: { createdAt: { gte: from, lte: to } },
      }),
      this.prisma.webhookDelivery.count({
        where: {
          status: { in: ['FAILED', 'EXHAUSTED'] },
          createdAt: { gte: from, lte: to },
        },
      }),
      this.prisma.customDomain.count({ where: { deletedAt: null } }),
      this.prisma.customDomain.count({
        where: { deletedAt: null, status: 'ACTIVE' },
      }),
    ]);

    const currencies = new Set(
      activeSubscriptionPlans.map((s) => s.plan.currency),
    );
    const mrrAmount = activeSubscriptionPlans.reduce((sum, s) => {
      const monthly =
        s.plan.billingInterval === BillingInterval.ANNUAL
          ? Math.round(s.plan.priceAmount / 12)
          : s.plan.priceAmount;
      return sum + monthly;
    }, 0);

    return {
      users: { total: totalUsers, active: activeUsers },
      workspaces: { total: totalWorkspaces },
      links: { active: activeLinks },
      clicks: { inRange: clicksInRange },
      subscriptions: {
        active: activeSubs,
        trialing: trialingSubs,
        pastDue: pastDueSubs,
      },
      mrr: {
        amount: mrrAmount,
        currency: currencies.size === 1 ? [...currencies][0]! : null,
        note:
          currencies.size > 1
            ? `Active plans span ${currencies.size} currencies (${[...currencies].join(', ')}) — summed without conversion.`
            : null,
      },
      revenue: {
        collectedInRange: revenueInRange._sum.amount ?? 0,
        currency: currencies.size === 1 ? [...currencies][0]! : null,
      },
      paymentFailures: { inRange: paymentFailuresInRange },
      apiRequests: { inRange: apiRequestsInRange },
      webhookFailures: { inRange: webhookFailuresInRange },
      domains: { total: totalDomains, active: activeDomains },
    };
  }
}
