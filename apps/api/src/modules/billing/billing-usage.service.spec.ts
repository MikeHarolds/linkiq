import { PlanLimitKey, PlanTier, SubscriptionStatus } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';

import { BillingUsageService } from './billing-usage.service';
import { PlanLimitExceededException } from './exceptions/plan-limit-exceeded.exception';
import type { PlanWithLimits } from './plans.service';
import type {
  SubscriptionsService,
  SubscriptionWithPlan,
} from './subscriptions.service';

function makePlan(limits: { key: PlanLimitKey; value: number | null }[]): PlanWithLimits {
  return {
    id: 'plan-1',
    name: 'Starter',
    slug: 'starter',
    tier: PlanTier.STARTER,
    description: null,
    priceAmount: 1900,
    currency: 'USD',
    billingInterval: 'MONTHLY',
    trialDays: null,
    isActive: true,
    displayOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    limits: limits.map((l, i) => ({
      id: `limit-${i}`,
      planId: 'plan-1',
      key: l.key,
      value: l.value,
    })),
  } as PlanWithLimits;
}

const noSubscription: SubscriptionWithPlan | null = null;

describe('BillingUsageService', () => {
  let prisma: MockPrismaService;
  let subscriptions: jest.Mocked<Pick<SubscriptionsService, 'getEffectivePlan'>>;
  let audit: AuditService;
  let service: BillingUsageService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    subscriptions = { getEffectivePlan: jest.fn() };
    audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    service = new BillingUsageService(
      prisma as unknown as PrismaService,
      subscriptions as unknown as SubscriptionsService,
      audit,
    );
  });

  describe('canUse / getLimit / getRemaining', () => {
    it('always allows use on an unlimited (null) limit', async () => {
      subscriptions.getEffectivePlan.mockResolvedValue({
        plan: makePlan([{ key: PlanLimitKey.MAX_LINKS, value: null }]),
        subscription: noSubscription,
        effectiveStatus: null,
      });

      const allowed = await service.canUse('ws-1', PlanLimitKey.MAX_LINKS);

      expect(allowed).toBe(true);
      expect(prisma.link.count).not.toHaveBeenCalled();
    });

    it('treats a missing PlanLimit row as unlimited (fail-open)', async () => {
      subscriptions.getEffectivePlan.mockResolvedValue({
        plan: makePlan([]),
        subscription: noSubscription,
        effectiveStatus: null,
      });

      const limit = await service.getLimit('ws-1', PlanLimitKey.MAX_LINKS);

      expect(limit).toBeNull();
    });

    it('blocks use once usage + amount exceeds a configured limit', async () => {
      subscriptions.getEffectivePlan.mockResolvedValue({
        plan: makePlan([{ key: PlanLimitKey.MAX_LINKS, value: 5 }]),
        subscription: noSubscription,
        effectiveStatus: null,
      });
      prisma.link.count.mockResolvedValue(5);

      const allowed = await service.canUse('ws-1', PlanLimitKey.MAX_LINKS);

      expect(allowed).toBe(false);
    });

    it('always blocks on a zero limit', async () => {
      subscriptions.getEffectivePlan.mockResolvedValue({
        plan: makePlan([{ key: PlanLimitKey.MAX_CUSTOM_DOMAINS, value: 0 }]),
        subscription: noSubscription,
        effectiveStatus: null,
      });
      prisma.customDomain.count.mockResolvedValue(0);

      const allowed = await service.canUse('ws-1', PlanLimitKey.MAX_CUSTOM_DOMAINS);

      expect(allowed).toBe(false);
    });

    it('computes remaining capacity, floored at zero', async () => {
      subscriptions.getEffectivePlan.mockResolvedValue({
        plan: makePlan([{ key: PlanLimitKey.MAX_QR_CODES, value: 10 }]),
        subscription: noSubscription,
        effectiveStatus: null,
      });
      prisma.qrCode.count.mockResolvedValue(12);

      const remaining = await service.getRemaining('ws-1', PlanLimitKey.MAX_QR_CODES);

      expect(remaining).toBe(0);
    });

    it('returns null remaining for an unlimited plan', async () => {
      subscriptions.getEffectivePlan.mockResolvedValue({
        plan: makePlan([{ key: PlanLimitKey.MAX_QR_CODES, value: null }]),
        subscription: noSubscription,
        effectiveStatus: null,
      });

      const remaining = await service.getRemaining('ws-1', PlanLimitKey.MAX_QR_CODES);

      expect(remaining).toBeNull();
    });
  });

  describe('assertCanUse', () => {
    it('resolves silently when capacity remains', async () => {
      subscriptions.getEffectivePlan.mockResolvedValue({
        plan: makePlan([{ key: PlanLimitKey.MAX_CAMPAIGNS, value: 3 }]),
        subscription: noSubscription,
        effectiveStatus: null,
      });
      prisma.campaign.count.mockResolvedValue(1);

      await expect(
        service.assertCanUse('ws-1', PlanLimitKey.MAX_CAMPAIGNS, 'campaigns'),
      ).resolves.toBeUndefined();
    });

    it('throws PlanLimitExceededException with the exact usage/limit when exhausted', async () => {
      subscriptions.getEffectivePlan.mockResolvedValue({
        plan: makePlan([{ key: PlanLimitKey.MAX_CAMPAIGNS, value: 3 }]),
        subscription: noSubscription,
        effectiveStatus: null,
      });
      prisma.campaign.count.mockResolvedValue(3);

      let caught: PlanLimitExceededException | undefined;
      try {
        await service.assertCanUse('ws-1', PlanLimitKey.MAX_CAMPAIGNS, 'campaigns');
      } catch (error) {
        caught = error as PlanLimitExceededException;
      }

      expect(caught).toBeInstanceOf(PlanLimitExceededException);
      expect(caught?.getResponse()).toMatchObject({
        code: 'PLAN_LIMIT_REACHED',
        feature: 'campaigns',
        limit: 3,
        usage: 3,
        remaining: 0,
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'billing.limit_reached',
          workspaceId: 'ws-1',
          metadata: expect.objectContaining({
            key: PlanLimitKey.MAX_CAMPAIGNS,
            feature: 'campaigns',
            limit: 3,
            usage: 3,
          }),
        }),
      );
    });
  });

  describe('getUsage', () => {
    it('reports a snapshot for every metered key, counting from the correct table', async () => {
      subscriptions.getEffectivePlan.mockResolvedValue({
        plan: makePlan([
          { key: PlanLimitKey.MAX_LINKS, value: 25 },
          { key: PlanLimitKey.MAX_QR_CODES, value: 10 },
          { key: PlanLimitKey.MAX_CAMPAIGNS, value: 3 },
          { key: PlanLimitKey.MAX_CUSTOM_DOMAINS, value: 0 },
          { key: PlanLimitKey.MAX_TEAM_MEMBERS, value: 3 },
          { key: PlanLimitKey.MONTHLY_CLICKS, value: 1000 },
        ]),
        subscription: noSubscription,
        effectiveStatus: null,
      });
      prisma.link.count.mockResolvedValue(5);
      prisma.qrCode.count.mockResolvedValue(2);
      prisma.campaign.count.mockResolvedValue(1);
      prisma.customDomain.count.mockResolvedValue(0);
      prisma.workspaceMember.count.mockResolvedValue(1);
      prisma.linkDailyStat.aggregate.mockResolvedValue({ _sum: { totalClicks: 42 } });

      const usage = await service.getUsage('ws-1');

      expect(usage).toEqual(
        expect.arrayContaining([
          { key: PlanLimitKey.MAX_LINKS, usage: 5, limit: 25, remaining: 20, unlimited: false },
          {
            key: PlanLimitKey.MONTHLY_CLICKS,
            usage: 42,
            limit: 1000,
            remaining: 958,
            unlimited: false,
          },
        ]),
      );
    });

    it('sums monthly clicks over the subscription billing period when one exists', async () => {
      const subscription = {
        currentPeriodStart: new Date('2026-02-01'),
        currentPeriodEnd: new Date('2026-03-01'),
      } as SubscriptionWithPlan;
      subscriptions.getEffectivePlan.mockResolvedValue({
        plan: makePlan([{ key: PlanLimitKey.MONTHLY_CLICKS, value: 1000 }]),
        subscription,
        effectiveStatus: SubscriptionStatus.ACTIVE,
      });
      prisma.linkDailyStat.aggregate.mockResolvedValue({ _sum: { totalClicks: 10 } });

      await service.getUsage('ws-1');

      expect(prisma.linkDailyStat.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: 'ws-1',
            date: { gte: subscription.currentPeriodStart, lt: subscription.currentPeriodEnd },
          }),
        }),
      );
    });

    it('treats a null click sum as zero usage', async () => {
      subscriptions.getEffectivePlan.mockResolvedValue({
        plan: makePlan([{ key: PlanLimitKey.MONTHLY_CLICKS, value: 1000 }]),
        subscription: noSubscription,
        effectiveStatus: null,
      });
      prisma.linkDailyStat.aggregate.mockResolvedValue({ _sum: { totalClicks: null } });

      const usage = await service.getUsage('ws-1');
      const clicks = usage.find((u) => u.key === PlanLimitKey.MONTHLY_CLICKS);

      expect(clicks?.usage).toBe(0);
    });
  });
});
