// Set BEFORE createTestApp() compiles AppModule — this file exercises
// the BILLING_PROVIDER=paystack branch specifically. Other e2e files
// never set this, so they stay on BILLING_PROVIDER=development
// (unaffected by anything here — see billing.e2e-spec.ts, which must
// keep passing unmodified per the hard constraint in
// docs/architecture/paystack-integration.md).
process.env.BILLING_PROVIDER = 'paystack';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_e2e_checkout_secret';

import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import request from 'supertest';

import { PaystackApiClient } from '../src/modules/billing/providers/paystack/paystack-api.client';
import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

/**
 * A fake PaystackApiClient — no real network call anywhere in this file,
 * per docs/architecture/paystack-integration.md §14's test strategy.
 * Only the methods this flow actually exercises return realistic data;
 * everything else is a plain jest.fn() stub.
 */
function makeFakeApiClient() {
  return {
    createCustomer: jest.fn(),
    initializeTransaction: jest.fn().mockResolvedValue({
      authorizationUrl: 'https://checkout.paystack.com/fake-session',
      accessCode: 'access_fake',
      reference: 'txn-fake-reference',
    }),
    // Echoes back whatever reference it's called with — matching real
    // Paystack behavior (verify-by-reference returns data FOR that
    // reference) and required for Sprint 18A's invoice correlation
    // (InvoicesService.findByProviderReference) to find the invoice
    // proceedToPayment actually attached a reference to.
    verifyTransaction: jest.fn().mockImplementation((reference: string) =>
      Promise.resolve({
        status: 'success',
        reference,
        amountKobo: 190000,
        currency: 'USD',
        customerCode: 'CUS_fake',
        authorizationCode: null,
        planCode: 'PLN_fake',
        paidAt: new Date(),
        metadata: null,
      }),
    ),
    createPlan: jest.fn(),
    createSubscription: jest.fn(),
    disableSubscription: jest.fn().mockResolvedValue(undefined),
    getSubscription: jest.fn(),
    createRefund: jest.fn(),
  };
}

describe('Paystack Checkout Flow (e2e, BILLING_PROVIDER=paystack)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let server: Parameters<typeof request>[0];
  let fakeApiClient: ReturnType<typeof makeFakeApiClient>;

  beforeAll(async () => {
    fakeApiClient = makeFakeApiClient();
    const testApp = await createTestApp((builder) =>
      builder.overrideProvider(PaystackApiClient).useValue(fakeApiClient),
    );
    app = testApp.app;
    prisma = testApp.prisma;
    redis = testApp.redis;
    server = app.getHttpServer();

    // PlansService caches its full plan list in-memory for 5 minutes
    // (see plans.service.ts) — created once, up front, before any test's
    // first getBySlug() call populates that cache, so every plan this
    // file needs is visible for the whole suite. Creating these
    // mid-test (after the cache is already warm) would 404.
    await createNoTrialPurchasablePlan('e2e-no-trial-1', 'PLN_e2e_1');
    await createNoTrialPurchasablePlan('e2e-no-trial-2', null);
    await createNoTrialPurchasablePlan('e2e-no-trial-3', 'PLN_e2e_3');
  });

  beforeEach(async () => {
    await resetDatabase(prisma, redis);
    await prisma.billingEvent.deleteMany({ where: { provider: 'paystack' } });
    jest.clearAllMocks();
    fakeApiClient.initializeTransaction.mockResolvedValue({
      authorizationUrl: 'https://checkout.paystack.com/fake-session',
      accessCode: 'access_fake',
      reference: 'txn-fake-reference',
    });
    fakeApiClient.verifyTransaction.mockImplementation((reference: string) =>
      Promise.resolve({
        status: 'success',
        reference,
        amountKobo: 190000,
        currency: 'USD',
        customerCode: 'CUS_fake',
        authorizationCode: null,
        planCode: 'PLN_fake',
        paidAt: new Date(),
        metadata: null,
      }),
    );
    fakeApiClient.disableSubscription.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await resetDatabase(prisma, redis);
    await prisma.billingEvent.deleteMany({ where: { provider: 'paystack' } });
    await app.close();
  }, 30000);

  async function registerUser(email: string) {
    const res = await request(server).post('/api/v1/auth/register').send({
      firstName: 'Test',
      lastName: 'User',
      email,
      password: 'SecurePass123',
      passwordConfirmation: 'SecurePass123',
      termsAccepted: true,
    });
    return {
      accessToken: res.body.accessToken as string,
      userId: res.body.user.id as string,
      workspaceId: res.body.workspaces[0].id as string,
    };
  }

  function headers(actor: { accessToken: string }) {
    return { Authorization: `Bearer ${actor.accessToken}` };
  }

  function billingBase(workspaceId: string) {
    return `/api/v1/workspaces/${workspaceId}/billing`;
  }

  /** All seeded purchasable plans (starter/professional/business) carry
   * a 14-day trial, which subscribe() intentionally never routes through
   * Paystack at all (see paystack-integration.md §2) — trials are
   * LinkIQ-only regardless of provider. To exercise the real-checkout
   * branch of subscribe() itself, this creates a dedicated no-trial,
   * purchasable plan rather than repurposing seed data whose trial would
   * make the assertion untestable. */
  async function createNoTrialPurchasablePlan(
    slug: string,
    providerPlanId: string | null,
  ) {
    // upsert, not create: resetDatabase() deliberately never touches
    // Plan rows (shared with real seed data), so a leftover row from a
    // previous run of this same file would otherwise collide on the
    // unique slug. Also re-asserts isActive: true on the update branch
    // — a previous run's deactivate test (see the "plan is not
    // currently available" scenario below) leaves this row deactivated
    // otherwise, permanently poisoning every subsequent run.
    return prisma.plan.upsert({
      where: { slug },
      create: {
        name: `E2E ${slug}`,
        slug,
        tier: 'STARTER',
        priceAmount: 190000,
        currency: 'USD',
        billingInterval: 'MONTHLY',
        trialDays: null,
        isActive: true,
        displayOrder: 99,
        providerPlanId,
      },
      update: { providerPlanId, isActive: true },
    });
  }

  describe('subscribe()', () => {
    it('Sprint 18A — creates a PENDING invoice and leaves the subscription unchanged (no trial, real provider)', async () => {
      const owner = await registerUser('checkout-sub1@example.com');

      const res = await request(server)
        .post(`${billingBase(owner.workspaceId)}/subscribe`)
        .set(headers(owner))
        .send({ planSlug: 'e2e-no-trial-1' });

      expect(res.status).toBe(200);
      expect(res.body.checkoutUrl).toBeNull();
      expect(res.body.invoice).toEqual(
        expect.objectContaining({ status: 'PENDING', amount: 190000, currency: 'USD' }),
      );
      // Nothing applied yet — still on the default FREE plan.
      expect(res.body.plan.slug).toBe('free');
      // No Paystack call at all — invoice-first plan selection never
      // initializes a real transaction; that only happens at
      // "Proceed to Payment" (see the describe block below).
      expect(fakeApiClient.initializeTransaction).not.toHaveBeenCalled();

      const sub = await prisma.subscription.findUnique({
        where: { workspaceId: owner.workspaceId },
      });
      expect(sub?.status).toBe('ACTIVE'); // still the default FREE subscription
      expect(sub?.providerCustomerId).toBeNull();

      const invoice = await prisma.invoice.findUnique({
        where: { id: res.body.invoice.id },
      });
      expect(invoice?.status).toBe('PENDING');
      expect(invoice?.targetPlanId).not.toBeNull();
    });

    it('Sprint 18B §17 — a plan with NO providerPlanId configured is still fully checkout-able (amount/currency-driven, not plan-code-driven)', async () => {
      const owner = await registerUser('checkout-sub2@example.com');

      const selectRes = await request(server)
        .post(`${billingBase(owner.workspaceId)}/subscribe`)
        .set(headers(owner))
        .send({ planSlug: 'e2e-no-trial-2' });

      expect(selectRes.status).toBe(200);
      expect(selectRes.body.invoice.status).toBe('PENDING');

      const payRes = await request(server)
        .post(
          `${billingBase(owner.workspaceId)}/invoices/${selectRes.body.invoice.id}/pay`,
        )
        .set(headers(owner));

      expect(payRes.status).toBe(200);
      expect(payRes.body.checkoutUrl).toBeTruthy();
      expect(fakeApiClient.initializeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ amountKobo: 190000, currency: 'USD' }),
      );
      expect(fakeApiClient.initializeTransaction).toHaveBeenCalledWith(
        expect.not.objectContaining({ planCode: expect.anything() }),
      );
    });

    it('still starts a LinkIQ-only trial with zero Paystack calls for a trialing plan', async () => {
      const owner = await registerUser('checkout-sub3@example.com');

      const res = await request(server)
        .post(`${billingBase(owner.workspaceId)}/subscribe`)
        .set(headers(owner))
        .send({ planSlug: 'starter' }); // seeded plan, has a 14-day trial

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('TRIALING');
      expect(res.body.checkoutUrl).toBeNull();
      expect(fakeApiClient.initializeTransaction).not.toHaveBeenCalled();
    });
  });

  describe('GET checkout/callback', () => {
    it('is read-only — reports success without mutating the subscription (the webhook remains authoritative)', async () => {
      const owner = await registerUser('checkout-cb1@example.com');

      const res = await request(server)
        .get(`${billingBase(owner.workspaceId)}/checkout/callback`)
        .query({ reference: 'txn-fake-reference' })
        .set(headers(owner));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(fakeApiClient.verifyTransaction).toHaveBeenCalledWith(
        'txn-fake-reference',
      );

      // Still the untouched default FREE subscription — verifyTransaction
      // never activates anything itself.
      const sub = await prisma.subscription.findUnique({
        where: { workspaceId: owner.workspaceId },
      });
      expect(sub?.provider).toBeNull();
    });

    it('reports failure without throwing when Paystack says the transaction did not succeed', async () => {
      const owner = await registerUser('checkout-cb2@example.com');
      fakeApiClient.verifyTransaction.mockResolvedValue({
        status: 'abandoned',
        reference: 'txn-fake-reference',
        amountKobo: 190000,
        currency: 'USD',
        customerCode: null,
        authorizationCode: null,
        planCode: null,
        paidAt: null,
        metadata: null,
      });

      const res = await request(server)
        .get(`${billingBase(owner.workspaceId)}/checkout/callback`)
        .query({ reference: 'txn-fake-reference' })
        .set(headers(owner));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
    });

    it('rejects a missing reference (400)', async () => {
      const owner = await registerUser('checkout-cb3@example.com');

      const res = await request(server)
        .get(`${billingBase(owner.workspaceId)}/checkout/callback`)
        .set(headers(owner));

      expect(res.status).toBe(400);
    });
  });

  describe('changePlan() with an existing real provider subscription', () => {
    it('Sprint 18A — creates a PENDING invoice instead of an in-place swap or an immediate checkout', async () => {
      const owner = await registerUser('checkout-change1@example.com');
      await prisma.subscription.update({
        where: { workspaceId: owner.workspaceId },
        data: {
          provider: 'paystack',
          providerSubscriptionId: 'SUB_e2e_x:tok_e2e_x',
        },
      });

      const res = await request(server)
        .post(`${billingBase(owner.workspaceId)}/change-plan`)
        .set(headers(owner))
        .send({ planSlug: 'e2e-no-trial-3' });

      expect(res.status).toBe(200);
      expect(res.body.checkoutUrl).toBeNull();
      expect(res.body.invoice.status).toBe('PENDING');
      expect(fakeApiClient.initializeTransaction).not.toHaveBeenCalled();

      // The old plan is still in effect — nothing applied until payment
      // is initiated (proceed-to-payment) AND verified.
      const sub = await prisma.subscription.findUnique({
        where: { workspaceId: owner.workspaceId },
        include: { plan: true },
      });
      expect(sub?.plan.slug).toBe('free');
    });
  });

  describe('Invoice-first flow: proceed to payment, callback verification, and activation', () => {
    it('proceeds to payment, initializes a real transaction against the invoice, and returns a checkoutUrl', async () => {
      const owner = await registerUser('checkout-e2e-pay1@example.com');

      const selectRes = await request(server)
        .post(`${billingBase(owner.workspaceId)}/subscribe`)
        .set(headers(owner))
        .send({ planSlug: 'e2e-no-trial-1' });
      const invoiceId = selectRes.body.invoice.id as string;

      const payRes = await request(server)
        .post(`${billingBase(owner.workspaceId)}/invoices/${invoiceId}/pay`)
        .set(headers(owner));

      expect(payRes.status).toBe(200);
      expect(payRes.body.checkoutUrl).toBe(
        'https://checkout.paystack.com/fake-session',
      );
      expect(fakeApiClient.initializeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'checkout-e2e-pay1@example.com',
          amountKobo: 190000,
          currency: 'USD',
          metadata: expect.objectContaining({ invoiceId }),
        }),
      );

      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
      });
      expect(invoice?.status).toBe('PENDING');
      // The fake client generates its own reference at initialize-time
      // (see PaystackBillingProvider.createCheckoutSession) — not the
      // hardcoded value verifyTransaction happens to echo back.
      expect(invoice?.providerInvoiceId).toEqual(expect.any(String));
    });

    it('the callback independently verifies, marks the invoice PAID, and activates the subscription only on success', async () => {
      const owner = await registerUser('checkout-e2e-pay2@example.com');
      const selectRes = await request(server)
        .post(`${billingBase(owner.workspaceId)}/subscribe`)
        .set(headers(owner))
        .send({ planSlug: 'e2e-no-trial-1' });
      const invoiceId = selectRes.body.invoice.id as string;

      await request(server)
        .post(`${billingBase(owner.workspaceId)}/invoices/${invoiceId}/pay`)
        .set(headers(owner));
      const pendingInvoice = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
      });
      const reference = pendingInvoice.providerInvoiceId!;

      // Still unchanged before the callback — redirect-back alone must
      // never be trusted as success.
      const beforeCallback = await prisma.subscription.findUnique({
        where: { workspaceId: owner.workspaceId },
        include: { plan: true },
      });
      expect(beforeCallback?.plan.slug).toBe('free');

      const callbackRes = await request(server)
        .get(`${billingBase(owner.workspaceId)}/checkout/callback`)
        .query({ reference })
        .set(headers(owner));

      expect(callbackRes.status).toBe(200);
      expect(callbackRes.body.success).toBe(true);
      expect(callbackRes.body.invoice.status).toBe('PAID');
      expect(fakeApiClient.verifyTransaction).toHaveBeenCalledWith(reference);

      const afterCallback = await prisma.subscription.findUnique({
        where: { workspaceId: owner.workspaceId },
        include: { plan: true },
      });
      expect(afterCallback?.plan.slug).toBe('e2e-no-trial-1');
      expect(afterCallback?.status).toBe('ACTIVE');
      expect(afterCallback?.amount).toBe(190000);
      expect(afterCallback?.currency).toBe('USD');

      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
      });
      expect(invoice?.status).toBe('PAID');
      expect(invoice?.paidAt).not.toBeNull();
    });

    it('is idempotent — a repeat callback call never re-activates or duplicates the invoice', async () => {
      const owner = await registerUser('checkout-e2e-pay3@example.com');
      const selectRes = await request(server)
        .post(`${billingBase(owner.workspaceId)}/subscribe`)
        .set(headers(owner))
        .send({ planSlug: 'e2e-no-trial-1' });
      const invoiceId = selectRes.body.invoice.id as string;
      await request(server)
        .post(`${billingBase(owner.workspaceId)}/invoices/${invoiceId}/pay`)
        .set(headers(owner));
      const pendingInvoice = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
      });
      const reference = pendingInvoice.providerInvoiceId!;

      await request(server)
        .get(`${billingBase(owner.workspaceId)}/checkout/callback`)
        .query({ reference })
        .set(headers(owner));

      const invoiceCountBefore = await prisma.invoice.count({
        where: { workspaceId: owner.workspaceId },
      });

      const secondRes = await request(server)
        .get(`${billingBase(owner.workspaceId)}/checkout/callback`)
        .query({ reference })
        .set(headers(owner));

      expect(secondRes.status).toBe(200);
      expect(secondRes.body.invoice.status).toBe('PAID');
      const invoiceCountAfter = await prisma.invoice.count({
        where: { workspaceId: owner.workspaceId },
      });
      expect(invoiceCountAfter).toBe(invoiceCountBefore);
    });

    it('an amount mismatch is rejected — the invoice is marked FAILED and the subscription is never activated', async () => {
      const owner = await registerUser('checkout-e2e-pay4@example.com');
      const selectRes = await request(server)
        .post(`${billingBase(owner.workspaceId)}/subscribe`)
        .set(headers(owner))
        .send({ planSlug: 'e2e-no-trial-1' });
      const invoiceId = selectRes.body.invoice.id as string;
      await request(server)
        .post(`${billingBase(owner.workspaceId)}/invoices/${invoiceId}/pay`)
        .set(headers(owner));
      const pendingInvoice = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
      });
      const reference = pendingInvoice.providerInvoiceId!;

      fakeApiClient.verifyTransaction.mockResolvedValueOnce({
        status: 'success',
        reference,
        amountKobo: 1, // tampered — does not match the invoice's own 190000
        currency: 'USD',
        customerCode: 'CUS_fake',
        authorizationCode: null,
        planCode: 'PLN_fake',
        paidAt: new Date(),
        metadata: null,
      });

      const res = await request(server)
        .get(`${billingBase(owner.workspaceId)}/checkout/callback`)
        .query({ reference })
        .set(headers(owner));

      expect(res.status).toBe(200);
      expect(res.body.invoice.status).toBe('FAILED');
      expect(res.body.success).toBe(false);

      const sub = await prisma.subscription.findUnique({
        where: { workspaceId: owner.workspaceId },
        include: { plan: true },
      });
      expect(sub?.plan.slug).toBe('free');
    });

    it('a downgrade never creates an invoice or calls Paystack', async () => {
      const owner = await registerUser('checkout-e2e-downgrade1@example.com');
      // Move to a paid plan first (force it directly, since this test
      // only cares about the downgrade path, not how it got there).
      const highPlan = await prisma.plan.findUniqueOrThrow({
        where: { slug: 'e2e-no-trial-3' },
      });
      await prisma.subscription.update({
        where: { workspaceId: owner.workspaceId },
        data: { planId: highPlan.id, amount: 190000, currency: 'USD' },
      });

      // Downgrading to the (already-cached, seeded) FREE plan is a pure
      // downgrade (0 < 190000) — never trial-eligible regardless of
      // trialDays, since trialEligible only applies to an upgrade.
      const res = await request(server)
        .post(`${billingBase(owner.workspaceId)}/change-plan`)
        .set(headers(owner))
        .send({ planSlug: 'free' });

      expect(res.status).toBe(200);
      expect(res.body.invoice).toBeNull();
      expect(res.body.checkoutUrl).toBeNull();
      expect(fakeApiClient.initializeTransaction).not.toHaveBeenCalled();

      const invoiceCount = await prisma.invoice.count({
        where: { workspaceId: owner.workspaceId, status: 'PENDING' },
      });
      expect(invoiceCount).toBe(0);
    });
  });

  describe('reactivate() after the underlying Paystack subscription was already disabled', () => {
    it('routes through a fresh checkout rather than silently clearing cancelAt', async () => {
      const owner = await registerUser('checkout-reactivate1@example.com');
      // Use a real (non-FREE) plan so the assertions below are about a
      // genuine paid reactivation, not incidental FREE-plan behavior.
      const plan = await prisma.plan.findUniqueOrThrow({
        where: { slug: 'e2e-no-trial-1' },
      });
      await prisma.subscription.update({
        where: { workspaceId: owner.workspaceId },
        data: {
          planId: plan.id,
          provider: 'paystack',
          providerSubscriptionId: 'SUB_e2e_y:tok_e2e_y',
          cancelAt: new Date(Date.now() + 86_400_000),
          canceledAt: new Date(),
        },
      });

      const res = await request(server)
        .post(`${billingBase(owner.workspaceId)}/reactivate`)
        .set(headers(owner));

      expect(res.status).toBe(200);
      expect(res.body.checkoutUrl).toBe(
        'https://checkout.paystack.com/fake-session',
      );

      const sub = await prisma.subscription.findUnique({
        where: { workspaceId: owner.workspaceId },
      });
      // cancelAt was NOT silently cleared — a fresh checkout is required.
      expect(sub?.cancelAt).not.toBeNull();
    });
  });

  describe('cancel() calls Paystack immediately', () => {
    it('calls disableSubscription when a real provider subscription exists', async () => {
      const owner = await registerUser('checkout-cancel1@example.com');
      await prisma.subscription.update({
        where: { workspaceId: owner.workspaceId },
        data: {
          provider: 'paystack',
          providerSubscriptionId: 'SUB_e2e_z:tok_e2e_z',
          currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        },
      });

      const res = await request(server)
        .post(`${billingBase(owner.workspaceId)}/cancel`)
        .set(headers(owner));

      expect(res.status).toBe(200);
      expect(fakeApiClient.disableSubscription).toHaveBeenCalledWith(
        'SUB_e2e_z',
        'tok_e2e_z',
      );
    });
  });
});
