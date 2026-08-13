import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingInterval, PlanTier, SubscriptionStatus } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { WebhookEventsService } from '../webhooks/webhook-events.service';

import type { PlansService } from './plans.service';
import type { BillingProvider } from './providers/billing-provider.interface';
import { SubscriptionsService } from './subscriptions.service';

const ctx: RequestContext = { ipAddress: '127.0.0.1', userAgent: 'jest' };

function makePlan(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'plan-free',
    name: 'Free',
    slug: 'free',
    tier: PlanTier.FREE,
    description: null,
    priceAmount: 0,
    currency: 'USD',
    billingInterval: BillingInterval.MONTHLY,
    trialDays: null,
    isActive: true,
    displayOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    limits: [],
    ...overrides,
  };
}

function makeSubscription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sub-1',
    workspaceId: 'ws-1',
    planId: 'plan-free',
    status: SubscriptionStatus.ACTIVE,
    currentPeriodStart: new Date('2026-01-01'),
    currentPeriodEnd: new Date('2026-02-01'),
    trialStart: null,
    trialEnd: null,
    cancelAt: null,
    canceledAt: null,
    provider: null,
    providerCustomerId: null,
    providerSubscriptionId: null,
    providerPriceId: null,
    plan: makePlan(),
    ...overrides,
  };
}

describe('SubscriptionsService', () => {
  let prisma: MockPrismaService;
  let plans: jest.Mocked<Pick<PlansService, 'getBySlug' | 'getFreePlan'>>;
  let audit: AuditService;
  let provider: jest.Mocked<BillingProvider>;
  let webhookEvents: { emit: jest.Mock };
  let service: SubscriptionsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    plans = {
      getBySlug: jest.fn(),
      getFreePlan: jest.fn(),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    provider = {
      createCheckoutSession: jest.fn().mockResolvedValue({ devFlow: true }),
      cancelSubscription: jest.fn().mockResolvedValue(undefined),
      changeSubscription: jest.fn().mockResolvedValue(undefined),
      getSubscription: jest.fn(),
      handleWebhook: jest.fn(),
    };
    webhookEvents = { emit: jest.fn().mockResolvedValue(undefined) };
    service = new SubscriptionsService(
      prisma as unknown as PrismaService,
      plans as unknown as PlansService,
      audit,
      provider,
      webhookEvents as unknown as WebhookEventsService,
    );
  });

  describe('createDefaultSubscription', () => {
    it('creates an ACTIVE subscription on the FREE plan', async () => {
      prisma.plan.findFirst.mockResolvedValue(makePlan());

      await service.createDefaultSubscription(
        prisma as unknown as never,
        'ws-1',
      );

      expect(prisma.subscription.create).toHaveBeenCalledWith({
        data: { workspaceId: 'ws-1', planId: 'plan-free', status: SubscriptionStatus.ACTIVE },
      });
    });

    it('throws when no FREE plan is configured (seed misconfiguration)', async () => {
      prisma.plan.findFirst.mockResolvedValue(null);

      await expect(
        service.createDefaultSubscription(prisma as unknown as never, 'ws-1'),
      ).rejects.toThrow('No FREE plan is configured');
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });
  });

  describe('getEffectivePlan', () => {
    it('falls back to the FREE plan when there is no subscription row', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);
      plans.getFreePlan.mockResolvedValue(makePlan());

      const result = await service.getEffectivePlan('ws-1');

      expect(result.subscription).toBeNull();
      expect(result.effectiveStatus).toBeNull();
      expect(result.plan.slug).toBe('free');
    });

    it('uses the subscribed plan while ACTIVE', async () => {
      const sub = makeSubscription({ plan: makePlan({ slug: 'starter' }) });
      prisma.subscription.findUnique.mockResolvedValue(sub);

      const result = await service.getEffectivePlan('ws-1');

      expect(result.effectiveStatus).toBe(SubscriptionStatus.ACTIVE);
      expect(result.plan.slug).toBe('starter');
    });

    it('uses the subscribed plan while TRIALING', async () => {
      const sub = makeSubscription({
        status: SubscriptionStatus.TRIALING,
        trialEnd: new Date(Date.now() + 86_400_000),
        plan: makePlan({ slug: 'starter' }),
      });
      prisma.subscription.findUnique.mockResolvedValue(sub);

      const result = await service.getEffectivePlan('ws-1');

      expect(result.effectiveStatus).toBe(SubscriptionStatus.TRIALING);
      expect(result.plan.slug).toBe('starter');
    });

    it('falls back to FREE when the trial has expired', async () => {
      const sub = makeSubscription({
        status: SubscriptionStatus.TRIALING,
        trialEnd: new Date(Date.now() - 86_400_000),
        plan: makePlan({ slug: 'starter' }),
      });
      prisma.subscription.findUnique.mockResolvedValue(sub);
      plans.getFreePlan.mockResolvedValue(makePlan());

      const result = await service.getEffectivePlan('ws-1');

      expect(result.effectiveStatus).toBe(SubscriptionStatus.EXPIRED);
      expect(result.plan.slug).toBe('free');
    });

    it('falls back to FREE once cancelAt has passed', async () => {
      const sub = makeSubscription({
        cancelAt: new Date(Date.now() - 1000),
        plan: makePlan({ slug: 'starter' }),
      });
      prisma.subscription.findUnique.mockResolvedValue(sub);
      plans.getFreePlan.mockResolvedValue(makePlan());

      const result = await service.getEffectivePlan('ws-1');

      expect(result.effectiveStatus).toBe(SubscriptionStatus.CANCELED);
      expect(result.plan.slug).toBe('free');
    });

    it('still uses the subscribed plan for PAST_DUE', async () => {
      const sub = makeSubscription({
        status: SubscriptionStatus.PAST_DUE,
        plan: makePlan({ slug: 'starter' }),
      });
      prisma.subscription.findUnique.mockResolvedValue(sub);

      const result = await service.getEffectivePlan('ws-1');

      expect(result.plan.slug).toBe('starter');
    });
  });

  describe('subscribe', () => {
    it('creates an ACTIVE subscription immediately when the plan has no trial', async () => {
      plans.getBySlug.mockResolvedValue(makePlan({ slug: 'starter', trialDays: null }));
      prisma.subscription.upsert.mockResolvedValue(
        makeSubscription({ status: SubscriptionStatus.ACTIVE }),
      );

      await service.subscribe('ws-1', 'user-1', 'starter', ctx);

      expect(provider.createCheckoutSession).toHaveBeenCalled();
      const upsertCall = prisma.subscription.upsert.mock.calls[0][0];
      expect(upsertCall.create.status).toBe(SubscriptionStatus.ACTIVE);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'subscription.created' }),
      );
      expect(audit.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.trial_started' }),
      );
    });

    it('grants a trial and audits it when the plan has trialDays', async () => {
      plans.getBySlug.mockResolvedValue(
        makePlan({ slug: 'starter', trialDays: 14 }),
      );
      prisma.subscription.upsert.mockResolvedValue(
        makeSubscription({ status: SubscriptionStatus.TRIALING }),
      );

      await service.subscribe('ws-1', 'user-1', 'starter', ctx);

      const upsertCall = prisma.subscription.upsert.mock.calls[0][0];
      expect(upsertCall.create.status).toBe(SubscriptionStatus.TRIALING);
      expect(upsertCall.create.trialEnd).toBeInstanceOf(Date);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.trial_started' }),
      );
    });

    it('rejects subscribing to an inactive plan', async () => {
      plans.getBySlug.mockResolvedValue(makePlan({ isActive: false }));

      await expect(
        service.subscribe('ws-1', 'user-1', 'discontinued', ctx),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });
  });

  describe('changePlan', () => {
    it('updates the plan and resets cancellation state', async () => {
      prisma.subscription.findUnique.mockResolvedValue(makeSubscription());
      plans.getBySlug.mockResolvedValue(makePlan({ id: 'plan-pro', slug: 'professional' }));
      prisma.subscription.update.mockResolvedValue(
        makeSubscription({ planId: 'plan-pro' }),
      );

      await service.changePlan('ws-1', 'user-1', 'professional', ctx);

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            planId: 'plan-pro',
            status: SubscriptionStatus.ACTIVE,
            cancelAt: null,
            canceledAt: null,
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.plan_changed' }),
      );
    });

    it('throws NotFoundException when the workspace has no subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(
        service.changePlan('ws-1', 'user-1', 'professional', ctx),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancel', () => {
    it('schedules cancellation at the end of the current period', async () => {
      const sub = makeSubscription({
        currentPeriodEnd: new Date('2026-03-01'),
      });
      prisma.subscription.findUnique.mockResolvedValue(sub);
      prisma.subscription.update.mockResolvedValue({ ...sub, cancelAt: sub.currentPeriodEnd });

      await service.cancel('ws-1', 'user-1', ctx);

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cancelAt: sub.currentPeriodEnd }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'subscription.canceled' }),
      );
    });

    it('rejects canceling an already-canceled subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        makeSubscription({ cancelAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.cancel('ws-1', 'user-1', ctx)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  describe('reactivate', () => {
    it('clears a pending cancellation', async () => {
      const sub = makeSubscription({ cancelAt: new Date(Date.now() + 86_400_000) });
      prisma.subscription.findUnique.mockResolvedValue(sub);
      prisma.subscription.update.mockResolvedValue({
        ...sub,
        cancelAt: null,
        canceledAt: null,
      });

      await service.reactivate('ws-1', 'user-1', ctx);

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { cancelAt: null, canceledAt: null },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'subscription.reactivated' }),
      );
    });

    it('rejects when there is no pending cancellation', async () => {
      prisma.subscription.findUnique.mockResolvedValue(makeSubscription({ cancelAt: null }));

      await expect(service.reactivate('ws-1', 'user-1', ctx)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when the cancellation has already taken effect', async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        makeSubscription({ cancelAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.reactivate('ws-1', 'user-1', ctx)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
