import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { BillingInterval, PlanTier, SubscriptionStatus } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import type { AuditService } from '../audit/audit.service';
import type { CurrencyService } from '../currency/currency.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RoleResolutionService } from '../roles/role-resolution.service';
import type { WebhookEventsService } from '../webhooks/webhook-events.service';

import type { InvoicesService } from './invoices.service';
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
    providerPlanId: null,
    platformRoleId: null,
    platformRole: null,
    isFeaturedOnHomepage: false,
    homepageOrder: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    limits: [],
    prices: [],
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
    currency: 'USD',
    amount: 0,
    plan: makePlan(),
    ...overrides,
  };
}

describe('SubscriptionsService', () => {
  let prisma: MockPrismaService;
  let plans: jest.Mocked<
    Pick<PlansService, 'getBySlug' | 'getFreePlan' | 'getByIdOrThrow'>
  >;
  let audit: AuditService;
  let config: { get: jest.Mock };
  let provider: jest.Mocked<BillingProvider>;
  let webhookEvents: { emit: jest.Mock };
  let roleResolution: { syncStoredRole: jest.Mock };
  let currencies: { getByCodeOrThrow: jest.Mock };
  let invoices: jest.Mocked<
    Pick<
      InvoicesService,
      | 'createOrReusePendingInvoice'
      | 'findPendingByIdForWorkspace'
      | 'findByIdForWorkspace'
      | 'findByProviderReference'
      | 'attachProviderReference'
      | 'markPaid'
      | 'markFailed'
    >
  >;
  let service: SubscriptionsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      email: 'user@example.com',
    });
    // Every subscribe/changePlan/cancel/reactivate success path now calls
    // syncOwnerRoles(), which queries workspaceMember for the workspace's
    // OWNER(s) — an empty default here keeps every pre-existing test in
    // this file behaviorally unchanged (no owners means syncOwnerRoles is
    // a harmless no-op); tests exercising role assignment explicitly
    // override this.
    prisma.workspaceMember.findMany.mockResolvedValue([]);
    plans = {
      getBySlug: jest.fn(),
      getFreePlan: jest.fn(),
      getByIdOrThrow: jest.fn(),
    };
    audit = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    config = { get: jest.fn().mockReturnValue(undefined) };
    provider = {
      createCheckoutSession: jest.fn().mockResolvedValue({ devFlow: true }),
      cancelSubscription: jest.fn().mockResolvedValue(undefined),
      changeSubscription: jest.fn().mockResolvedValue(undefined),
      getSubscription: jest.fn(),
      handleWebhook: jest.fn(),
      verifyTransaction: jest.fn(),
    };
    webhookEvents = { emit: jest.fn().mockResolvedValue(undefined) };
    roleResolution = { syncStoredRole: jest.fn().mockResolvedValue(undefined) };
    // Every subscribe/changePlan/reactivate call now resolves a
    // currency via CurrencyService — an active-currency default keeps
    // every pre-existing test in this file (all of which use the
    // default 'USD' plan currency) behaviorally unchanged; tests
    // exercising multi-currency behavior explicitly override this.
    currencies = {
      getByCodeOrThrow: jest.fn((code: string) =>
        Promise.resolve({ code, isActive: true }),
      ),
    };
    invoices = {
      createOrReusePendingInvoice: jest.fn(),
      findPendingByIdForWorkspace: jest.fn(),
      findByIdForWorkspace: jest.fn(),
      findByProviderReference: jest.fn(),
      attachProviderReference: jest.fn(),
      markPaid: jest.fn(),
      markFailed: jest.fn(),
    };
    service = new SubscriptionsService(
      prisma as unknown as PrismaService,
      plans as unknown as PlansService,
      audit,
      config as unknown as ConfigService,
      provider,
      webhookEvents as unknown as WebhookEventsService,
      roleResolution as unknown as RoleResolutionService,
      currencies as unknown as CurrencyService,
      invoices as unknown as InvoicesService,
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
        data: {
          workspaceId: 'ws-1',
          planId: 'plan-free',
          status: SubscriptionStatus.ACTIVE,
          currency: 'USD',
          amount: 0,
        },
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

  describe('verifyCheckout', () => {
    it('reports success and the current subscription without mutating anything', async () => {
      const sub = makeSubscription({ status: SubscriptionStatus.ACTIVE });
      prisma.subscription.findUnique.mockResolvedValue(sub);
      provider.verifyTransaction.mockResolvedValue({
        success: true,
        reference: 'txn-abc',
        amountKobo: 1900,
        currency: 'USD',
        customerCode: 'CUS_abc',
        metadata: null,
      });

      const result = await service.verifyCheckout('ws-1', 'txn-abc');

      expect(result).toEqual({ success: true, subscription: sub });
      expect(provider.verifyTransaction).toHaveBeenCalledWith('txn-abc');
      expect(prisma.subscription.update).not.toHaveBeenCalled();
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });

    it('reports failure without throwing when the transaction did not succeed', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);
      provider.verifyTransaction.mockResolvedValue({
        success: false,
        reference: 'txn-abc',
        amountKobo: 1900,
        currency: 'USD',
        customerCode: null,
        metadata: null,
      });

      const result = await service.verifyCheckout('ws-1', 'txn-abc');

      expect(result).toEqual({ success: false, subscription: null });
    });
  });

  describe('subscribe', () => {
    it('creates an ACTIVE subscription immediately when the plan has no trial (dev-flow, no real provider)', async () => {
      plans.getBySlug.mockResolvedValue(
        makePlan({ slug: 'starter', trialDays: null, priceAmount: 1900 }),
      );
      prisma.subscription.upsert.mockResolvedValue(
        makeSubscription({ status: SubscriptionStatus.ACTIVE }),
      );

      await service.subscribe('ws-1', 'user-1', 'starter', ctx);

      // Sprint 18A — with no real provider configured
      // (provider.getProviderName undefined, same as
      // DevelopmentBillingProvider), a payment-required move never
      // calls the provider at all anymore — it just applies directly,
      // exactly as dev-flow always has.
      expect(provider.createCheckoutSession).not.toHaveBeenCalled();
      expect(invoices.createOrReusePendingInvoice).not.toHaveBeenCalled();
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
        makePlan({ slug: 'starter', trialDays: 14, priceAmount: 1900 }),
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

    it('never calls the provider for a trialing plan (zero Paystack interaction)', async () => {
      plans.getBySlug.mockResolvedValue(
        makePlan({ slug: 'starter', trialDays: 14, priceAmount: 1900 }),
      );
      prisma.subscription.upsert.mockResolvedValue(
        makeSubscription({ status: SubscriptionStatus.TRIALING }),
      );

      await service.subscribe('ws-1', 'user-1', 'starter', ctx);

      expect(provider.createCheckoutSession).not.toHaveBeenCalled();
      expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('Sprint 18A — creates a PENDING invoice and leaves the subscription untouched for a real-provider plan requiring payment', async () => {
      const current = makeSubscription({ status: SubscriptionStatus.ACTIVE });
      const plan = makePlan({
        id: 'plan-starter',
        slug: 'starter',
        trialDays: null,
        priceAmount: 1900,
        providerPlanId: 'PLN_starter',
      });
      const pendingInvoice = {
        id: 'inv-1',
        status: 'PENDING',
        amount: 1900,
        currency: 'USD',
        targetPlanId: 'plan-starter',
      };
      plans.getBySlug.mockResolvedValue(plan);
      prisma.subscription.findUnique.mockResolvedValue(current);
      provider.getProviderName = jest.fn().mockReturnValue('paystack');
      invoices.createOrReusePendingInvoice.mockResolvedValue(
        pendingInvoice as never,
      );

      const result = await service.subscribe('ws-1', 'user-1', 'starter', ctx);

      expect(result).toEqual({
        subscription: current,
        checkoutUrl: null,
        invoice: pendingInvoice,
      });
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
      expect(provider.createCheckoutSession).not.toHaveBeenCalled();
      expect(invoices.createOrReusePendingInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-1',
          subscriptionId: current.id,
          targetPlanId: 'plan-starter',
          amount: 1900,
          currency: 'USD',
          provider: 'paystack',
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.invoice_created' }),
      );
      expect(webhookEvents.emit).not.toHaveBeenCalled();
    });

    it('Sprint 16 — stamps the resolved currency/amount onto the created subscription', async () => {
      plans.getBySlug.mockResolvedValue(
        makePlan({ slug: 'starter', trialDays: null }),
      );
      prisma.subscription.upsert.mockResolvedValue(makeSubscription());

      await service.subscribe('ws-1', 'user-1', 'starter', ctx);

      const upsertCall = prisma.subscription.upsert.mock.calls[0][0];
      expect(upsertCall.create.currency).toBe('USD');
      expect(upsertCall.create.amount).toBe(0);
    });

    it('Sprint 16 — resolves a currency-specific PlanPrice when a non-base currency is requested', async () => {
      plans.getBySlug.mockResolvedValue(
        makePlan({
          slug: 'professional',
          trialDays: null,
          currency: 'USD',
          priceAmount: 4900,
          prices: [{ currency: { code: 'NGN' }, amount: 7_500_000 }],
        }),
      );
      prisma.subscription.upsert.mockResolvedValue(makeSubscription());

      await service.subscribe('ws-1', 'user-1', 'professional', ctx, 'NGN');

      // Dev-flow (no real provider configured) never calls the
      // provider at all (Sprint 18A) — the resolved NGN price is
      // stamped straight onto the subscription instead.
      expect(provider.createCheckoutSession).not.toHaveBeenCalled();
      const upsertCall = prisma.subscription.upsert.mock.calls[0][0];
      expect(upsertCall.create.currency).toBe('NGN');
      expect(upsertCall.create.amount).toBe(7_500_000);
    });

    it('Sprint 16 §11 — rejects a currency the plan has no price configured for', async () => {
      plans.getBySlug.mockResolvedValue(
        makePlan({
          slug: 'professional',
          trialDays: null,
          currency: 'USD',
          prices: [],
        }),
      );

      await expect(
        service.subscribe('ws-1', 'user-1', 'professional', ctx, 'EUR'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });

    it('Sprint 16 §11 — rejects a currency the payment provider does not support', async () => {
      plans.getBySlug.mockResolvedValue(
        makePlan({
          slug: 'professional',
          trialDays: null,
          currency: 'USD',
          prices: [{ currency: { code: 'EUR' }, amount: 4500 }],
        }),
      );
      provider.getSupportedCurrencies = jest
        .fn()
        .mockReturnValue(['NGN', 'USD']);

      await expect(
        service.subscribe('ws-1', 'user-1', 'professional', ctx, 'EUR'),
      ).rejects.toThrow(BadRequestException);
      expect(provider.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('Sprint 16 §11 — rejects an inactive currency even if it is the plan base currency', async () => {
      plans.getBySlug.mockResolvedValue(
        makePlan({ slug: 'starter', trialDays: null }),
      );
      currencies.getByCodeOrThrow.mockResolvedValue({
        code: 'USD',
        isActive: false,
      });

      await expect(
        service.subscribe('ws-1', 'user-1', 'starter', ctx),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('changePlan', () => {
    it('updates the plan and resets cancellation state', async () => {
      prisma.subscription.findUnique.mockResolvedValue(makeSubscription());
      plans.getBySlug.mockResolvedValue(
        makePlan({ id: 'plan-pro', slug: 'professional' }),
      );
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

    it('Sprint 18A — creates a PENDING invoice instead of an in-place swap when upgrading a real provider subscription', async () => {
      const existing = makeSubscription({
        providerSubscriptionId: 'SUB_abc:tok_abc',
        currency: 'USD',
        amount: 1900,
      });
      const pendingInvoice = {
        id: 'inv-1',
        status: 'PENDING',
        amount: 4900,
        currency: 'USD',
        targetPlanId: 'plan-pro',
      };
      prisma.subscription.findUnique.mockResolvedValue(existing);
      plans.getBySlug.mockResolvedValue(
        makePlan({
          id: 'plan-pro',
          slug: 'professional',
          priceAmount: 4900,
          providerPlanId: 'PLN_pro',
        }),
      );
      provider.getProviderName = jest.fn().mockReturnValue('paystack');
      invoices.createOrReusePendingInvoice.mockResolvedValue(
        pendingInvoice as never,
      );

      const result = await service.changePlan(
        'ws-1',
        'user-1',
        'professional',
        ctx,
      );

      expect(result).toEqual({
        subscription: existing,
        checkoutUrl: null,
        invoice: pendingInvoice,
      });
      expect(provider.changeSubscription).not.toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
      expect(provider.createCheckoutSession).not.toHaveBeenCalled();
      expect(invoices.createOrReusePendingInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          targetPlanId: 'plan-pro',
          amount: 4900,
          currency: 'USD',
          provider: 'paystack',
        }),
      );
    });

    it("Sprint 16 — a dev-flow plan change stamps the new plan's resolved currency/amount, not the previous subscription's", async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        makeSubscription({ currency: 'USD', amount: 1900 }),
      );
      plans.getBySlug.mockResolvedValue(
        makePlan({
          id: 'plan-pro',
          slug: 'professional',
          currency: 'USD',
          priceAmount: 4900,
        }),
      );
      prisma.subscription.update.mockResolvedValue(
        makeSubscription({ planId: 'plan-pro' }),
      );

      await service.changePlan('ws-1', 'user-1', 'professional', ctx);

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currency: 'USD', amount: 4900 }),
        }),
      );
    });

    it("Sprint 17 §5 — requires checkout on a workspace's first-ever move from FREE to a paid plan (no providerSubscriptionId yet)", async () => {
      // The exact bug this sprint fixes: previously changePlan() only
      // required checkout when providerSubscriptionId was already set,
      // which a fresh FREE-default subscription never has — so the
      // very first paid conversion applied with zero payment.
      const existing = makeSubscription({
        amount: 0,
        currency: 'USD',
        providerSubscriptionId: null,
      });
      prisma.subscription.findUnique.mockResolvedValue(existing);
      plans.getBySlug.mockResolvedValue(
        makePlan({
          id: 'plan-pro',
          slug: 'professional',
          priceAmount: 4900,
          trialDays: null,
          providerPlanId: 'PLN_pro',
        }),
      );
      provider.getProviderName = jest.fn().mockReturnValue('paystack');
      invoices.createOrReusePendingInvoice.mockResolvedValue({
        id: 'inv-1',
        status: 'PENDING',
        amount: 4900,
        currency: 'USD',
        targetPlanId: 'plan-pro',
      } as never);

      const result = await service.changePlan(
        'ws-1',
        'user-1',
        'professional',
        ctx,
      );

      expect(invoices.createOrReusePendingInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ targetPlanId: 'plan-pro' }),
      );
      expect(provider.createCheckoutSession).not.toHaveBeenCalled();
      expect(result.checkoutUrl).toBeNull();
      expect(result.invoice).not.toBeNull();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('Sprint 17 §5 — grants a first-ever trial on an upgrade instead of requiring immediate payment', async () => {
      const existing = makeSubscription({
        amount: 0,
        currency: 'USD',
        trialUsed: false,
      });
      prisma.subscription.findUnique.mockResolvedValue(existing);
      plans.getBySlug.mockResolvedValue(
        makePlan({
          id: 'plan-pro',
          slug: 'professional',
          priceAmount: 4900,
          trialDays: 14,
        }),
      );
      prisma.subscription.update.mockResolvedValue(
        makeSubscription({ planId: 'plan-pro' }),
      );

      await service.changePlan('ws-1', 'user-1', 'professional', ctx);

      expect(provider.createCheckoutSession).not.toHaveBeenCalled();
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SubscriptionStatus.TRIALING,
            trialUsed: true,
            amount: 4900,
          }),
        }),
      );
    });

    it('Sprint 17 §5 — never grants a second trial once trialUsed is true, even on a genuine upgrade', async () => {
      const existing = makeSubscription({
        amount: 0,
        currency: 'USD',
        trialUsed: true,
      });
      prisma.subscription.findUnique.mockResolvedValue(existing);
      plans.getBySlug.mockResolvedValue(
        makePlan({
          id: 'plan-pro',
          slug: 'professional',
          priceAmount: 4900,
          trialDays: 14,
          providerPlanId: 'PLN_pro',
        }),
      );
      provider.getProviderName = jest.fn().mockReturnValue('paystack');
      invoices.createOrReusePendingInvoice.mockResolvedValue({
        id: 'inv-1',
        status: 'PENDING',
        amount: 4900,
        currency: 'USD',
        targetPlanId: 'plan-pro',
      } as never);

      const result = await service.changePlan(
        'ws-1',
        'user-1',
        'professional',
        ctx,
      );

      expect(invoices.createOrReusePendingInvoice).toHaveBeenCalled();
      expect(provider.createCheckoutSession).not.toHaveBeenCalled();
      expect(result.checkoutUrl).toBeNull();
      expect(result.invoice).not.toBeNull();
    });

    it('Sprint 17 §5 — a downgrade away from a real provider subscription applies immediately, never charges, and cancels the old subscription', async () => {
      const existing = makeSubscription({
        amount: 4900,
        currency: 'USD',
        providerSubscriptionId: 'SUB_abc:tok_abc',
      });
      prisma.subscription.findUnique.mockResolvedValue(existing);
      plans.getBySlug.mockResolvedValue(
        makePlan({
          id: 'plan-starter',
          slug: 'starter',
          priceAmount: 1900,
          trialDays: null,
        }),
      );
      prisma.subscription.update.mockResolvedValue(
        makeSubscription({ planId: 'plan-starter' }),
      );

      const result = await service.changePlan('ws-1', 'user-1', 'starter', ctx);

      expect(provider.createCheckoutSession).not.toHaveBeenCalled();
      expect(provider.cancelSubscription).toHaveBeenCalledWith(
        'SUB_abc:tok_abc',
      );
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 1900,
            currency: 'USD',
            status: SubscriptionStatus.ACTIVE,
            provider: null,
            providerSubscriptionId: null,
            providerPriceId: null,
          }),
        }),
      );
      expect(result.checkoutUrl).toBeNull();
    });

    it('Sprint 17 §5 — a lateral (same-price) move applies immediately without charging', async () => {
      const existing = makeSubscription({ amount: 4900, currency: 'USD' });
      prisma.subscription.findUnique.mockResolvedValue(existing);
      plans.getBySlug.mockResolvedValue(
        makePlan({
          id: 'plan-alt',
          slug: 'alt-professional',
          priceAmount: 4900,
          trialDays: null,
        }),
      );
      prisma.subscription.update.mockResolvedValue(
        makeSubscription({ planId: 'plan-alt' }),
      );

      await service.changePlan('ws-1', 'user-1', 'alt-professional', ctx);

      expect(provider.createCheckoutSession).not.toHaveBeenCalled();
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 4900 }),
        }),
      );
    });
  });

  describe('cancel', () => {
    it('schedules cancellation at the end of the current period', async () => {
      const sub = makeSubscription({
        currentPeriodEnd: new Date('2026-03-01'),
      });
      prisma.subscription.findUnique.mockResolvedValue(sub);
      prisma.subscription.update.mockResolvedValue({
        ...sub,
        cancelAt: sub.currentPeriodEnd,
      });

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
      const sub = makeSubscription({
        cancelAt: new Date(Date.now() + 86_400_000),
      });
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
      prisma.subscription.findUnique.mockResolvedValue(
        makeSubscription({ cancelAt: null }),
      );

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

    it('routes through a fresh checkout instead of a silent undo when a real provider subscription exists', async () => {
      const existing = makeSubscription({
        cancelAt: new Date(Date.now() + 86_400_000),
        providerSubscriptionId: 'SUB_abc:tok_abc',
      });
      prisma.subscription.findUnique.mockResolvedValue(existing);
      provider.createCheckoutSession.mockResolvedValue({
        devFlow: false,
        checkoutUrl: 'https://checkout.paystack.com/xyz',
      });

      const result = await service.reactivate('ws-1', 'user-1', ctx);

      expect(result).toEqual({
        subscription: existing,
        checkoutUrl: 'https://checkout.paystack.com/xyz',
        invoice: null,
      });
      expect(prisma.subscription.update).not.toHaveBeenCalled();
      expect(provider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          planSlug: existing.plan.slug,
          email: 'user@example.com',
        }),
      );
    });

    it("Sprint 16 §12 — reuses the subscription's own already-recorded currency, never a caller-supplied one", async () => {
      const existing = makeSubscription({
        cancelAt: new Date(Date.now() + 86_400_000),
        providerSubscriptionId: 'SUB_abc:tok_abc',
        currency: 'NGN',
        amount: 7_500_000,
      });
      prisma.subscription.findUnique.mockResolvedValue(existing);
      provider.createCheckoutSession.mockResolvedValue({
        devFlow: false,
        checkoutUrl: 'https://checkout.paystack.com/xyz',
      });

      await service.reactivate('ws-1', 'user-1', ctx);

      expect(provider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ currencyCode: 'NGN' }),
      );
    });
  });

  describe('proceedToPayment (Sprint 18A)', () => {
    function makePendingInvoice(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 'inv-1',
        workspaceId: 'ws-1',
        status: 'PENDING',
        amount: 4900,
        currency: 'NGN',
        targetPlanId: 'plan-pro',
        ...overrides,
      };
    }

    it('initializes checkout using the invoice\'s OWN currency/amount and attaches the resulting reference', async () => {
      invoices.findPendingByIdForWorkspace.mockResolvedValue(
        makePendingInvoice() as never,
      );
      plans.getByIdOrThrow.mockResolvedValue(
        makePlan({ id: 'plan-pro', slug: 'professional' }),
      );
      provider.createCheckoutSession.mockResolvedValue({
        devFlow: false,
        checkoutUrl: 'https://checkout.paystack.com/xyz',
        reference: 'txn-xyz',
      });

      const result = await service.proceedToPayment(
        'ws-1',
        'user-1',
        'inv-1',
        ctx,
      );

      expect(result).toEqual({ checkoutUrl: 'https://checkout.paystack.com/xyz' });
      expect(provider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          planSlug: 'professional',
          currencyCode: 'NGN',
          invoiceId: 'inv-1',
        }),
      );
      expect(invoices.attachProviderReference).toHaveBeenCalledWith(
        'inv-1',
        'txn-xyz',
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.checkout_initiated' }),
      );
    });

    it('never accepts a caller-supplied currency — only the invoice’s own stored currency reaches the provider', async () => {
      invoices.findPendingByIdForWorkspace.mockResolvedValue(
        makePendingInvoice({ currency: 'GHS' }) as never,
      );
      plans.getByIdOrThrow.mockResolvedValue(
        makePlan({ id: 'plan-pro', slug: 'professional' }),
      );
      provider.createCheckoutSession.mockResolvedValue({
        devFlow: false,
        checkoutUrl: 'https://checkout.paystack.com/xyz',
        reference: 'txn-xyz',
      });

      await service.proceedToPayment('ws-1', 'user-1', 'inv-1', ctx);

      expect(provider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ currencyCode: 'GHS' }),
      );
    });

    it('rejects when no PENDING invoice exists for this workspace/id', async () => {
      invoices.findPendingByIdForWorkspace.mockResolvedValue(null);

      await expect(
        service.proceedToPayment('ws-1', 'user-1', 'missing', ctx),
      ).rejects.toThrow(NotFoundException);
      expect(provider.createCheckoutSession).not.toHaveBeenCalled();
    });
  });

  describe('confirmAndActivate (Sprint 18A)', () => {
    function makePendingInvoice(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 'inv-1',
        workspaceId: 'ws-1',
        status: 'PENDING',
        amount: 4900,
        currency: 'USD',
        targetPlanId: 'plan-pro',
        ...overrides,
      };
    }

    it('activates the subscription and marks the invoice PAID on a fully-verified success', async () => {
      const invoice = makePendingInvoice();
      const existing = makeSubscription({ amount: 1900, currency: 'USD' });
      invoices.findByProviderReference.mockResolvedValue(invoice as never);
      prisma.subscription.findUnique.mockResolvedValue(existing);
      plans.getByIdOrThrow.mockResolvedValue(
        makePlan({ id: 'plan-pro', slug: 'professional' }),
      );
      prisma.subscription.update.mockResolvedValue(
        makeSubscription({ planId: 'plan-pro', amount: 4900 }),
      );
      invoices.markPaid.mockResolvedValue({
        ...invoice,
        status: 'PAID',
      } as never);

      const result = await service.confirmAndActivate({
        reference: 'txn-xyz',
        status: 'success',
        amountKobo: 4900,
        currency: 'USD',
        customerCode: 'CUS_abc',
        metadata: { workspaceId: 'ws-1' },
      });

      expect(result.applied).toBe(true);
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'ws-1' },
          data: expect.objectContaining({
            planId: 'plan-pro',
            status: SubscriptionStatus.ACTIVE,
            amount: 4900,
            currency: 'USD',
            providerCustomerId: 'CUS_abc',
          }),
        }),
      );
      expect(invoices.markPaid).toHaveBeenCalledWith(
        'inv-1',
        expect.any(Date),
        { start: expect.any(Date), end: expect.any(Date) },
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.payment_succeeded' }),
      );
    });

    it('marks the invoice FAILED and leaves the subscription unchanged on an amount mismatch', async () => {
      const invoice = makePendingInvoice({ amount: 4900 });
      invoices.findByProviderReference.mockResolvedValue(invoice as never);
      invoices.markFailed.mockResolvedValue({
        ...invoice,
        status: 'FAILED',
      } as never);
      prisma.subscription.findUnique.mockResolvedValue(
        makeSubscription({ amount: 1900 }),
      );

      const result = await service.confirmAndActivate({
        reference: 'txn-xyz',
        status: 'success',
        amountKobo: 999, // tampered/mismatched
        currency: 'USD',
        customerCode: 'CUS_abc',
        metadata: null,
      });

      expect(invoices.markFailed).toHaveBeenCalledWith(
        'inv-1',
        expect.any(String),
      );
      expect(prisma.subscription.update).not.toHaveBeenCalled();
      expect(result.invoice?.status).toBe('FAILED');
    });

    it('marks the invoice FAILED and leaves the subscription unchanged on a currency mismatch', async () => {
      const invoice = makePendingInvoice({ currency: 'USD' });
      invoices.findByProviderReference.mockResolvedValue(invoice as never);
      invoices.markFailed.mockResolvedValue({
        ...invoice,
        status: 'FAILED',
      } as never);
      prisma.subscription.findUnique.mockResolvedValue(makeSubscription());

      await service.confirmAndActivate({
        reference: 'txn-xyz',
        status: 'success',
        amountKobo: 4900,
        currency: 'NGN', // mismatched
        customerCode: 'CUS_abc',
        metadata: null,
      });

      expect(invoices.markFailed).toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('marks the invoice FAILED (never activates) when the provider itself reports a non-success status', async () => {
      const invoice = makePendingInvoice();
      invoices.findByProviderReference.mockResolvedValue(invoice as never);
      invoices.markFailed.mockResolvedValue({
        ...invoice,
        status: 'FAILED',
      } as never);
      prisma.subscription.findUnique.mockResolvedValue(makeSubscription());

      await service.confirmAndActivate({
        reference: 'txn-xyz',
        status: 'abandoned',
        amountKobo: 4900,
        currency: 'USD',
        customerCode: null,
        metadata: null,
      });

      expect(invoices.markFailed).toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('is idempotent — a repeat call against an already-PAID invoice never re-activates or re-audits', async () => {
      const paidInvoice = makePendingInvoice({ status: 'PAID' });
      invoices.findByProviderReference.mockResolvedValue(paidInvoice as never);
      prisma.subscription.findUnique.mockResolvedValue(makeSubscription());

      const result = await service.confirmAndActivate({
        reference: 'txn-xyz',
        status: 'success',
        amountKobo: 4900,
        currency: 'USD',
        customerCode: 'CUS_abc',
        metadata: null,
      });

      expect(result.applied).toBe(false);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
      expect(invoices.markPaid).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('is idempotent — a repeat call against an already-FAILED invoice is never resurrected to PAID', async () => {
      const failedInvoice = makePendingInvoice({ status: 'FAILED' });
      invoices.findByProviderReference.mockResolvedValue(
        failedInvoice as never,
      );
      prisma.subscription.findUnique.mockResolvedValue(makeSubscription());

      const result = await service.confirmAndActivate({
        reference: 'txn-xyz',
        status: 'success',
        amountKobo: 4900,
        currency: 'USD',
        customerCode: 'CUS_abc',
        metadata: null,
      });

      expect(result.applied).toBe(false);
      expect(invoices.markPaid).not.toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('returns invoice: null (no correlation) for a reference with no matching Invoice at all', async () => {
      invoices.findByProviderReference.mockResolvedValue(null);

      const result = await service.confirmAndActivate({
        reference: 'unrelated-txn',
        status: 'success',
        amountKobo: 4900,
        currency: 'USD',
        customerCode: 'CUS_abc',
        metadata: null,
      });

      expect(result).toEqual({
        invoice: null,
        subscription: null,
        applied: false,
      });
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });
  });
});
