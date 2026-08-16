// Runs the whole file under BILLING_PROVIDER=paystack (with a fake
// PaystackApiClient, same precedent as paystack-checkout.e2e-spec.ts)
// so the provider-currency-capability checks (Sprint 16 §11) exercise
// the REAL PaystackBillingProvider.getSupportedCurrencies() — a pure
// config read, no fake needed for that method — while every other
// currency endpoint in this file behaves identically to
// BILLING_PROVIDER=development.
process.env.BILLING_PROVIDER = 'paystack';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_e2e_currency_secret';

import type { INestApplication } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import type { Redis } from 'ioredis';
import request from 'supertest';

import { PaystackApiClient } from '../src/modules/billing/providers/paystack/paystack-api.client';
import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

function makeFakeApiClient() {
  return {
    createCustomer: jest.fn(),
    initializeTransaction: jest.fn().mockResolvedValue({
      authorizationUrl: 'https://checkout.paystack.com/fake-session',
      accessCode: 'access_fake',
      reference: 'txn-fake-reference',
    }),
    verifyTransaction: jest.fn(),
    createPlan: jest.fn(),
    createSubscription: jest.fn(),
    disableSubscription: jest.fn().mockResolvedValue(undefined),
    getSubscription: jest.fn(),
    createRefund: jest.fn(),
  };
}

describe('Currency, Localization & Multi-Currency Payments (e2e)', () => {
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
    // (see plans.service.ts) — created once, up front, before any
    // test's first getBySlug() call populates that cache, matching
    // paystack-checkout.e2e-spec.ts's own createNoTrialPurchasablePlan
    // rationale exactly. Every seeded plan carries a 14-day trial,
    // which subscribe() never routes through the provider at all.
    const ngn = await prisma.currency.findUniqueOrThrow({ where: { code: 'NGN' } });
    const plan = await prisma.plan.upsert({
      where: { slug: 'e2e-currency-plan' },
      create: {
        name: 'E2E Currency Plan',
        slug: 'e2e-currency-plan',
        tier: 'STARTER',
        priceAmount: 190000,
        currency: 'USD',
        billingInterval: 'MONTHLY',
        trialDays: null,
        isActive: true,
        displayOrder: 99,
        providerPlanId: 'PLN_e2e_usd',
      },
      update: { isActive: true, providerPlanId: 'PLN_e2e_usd' },
    });
    await prisma.planPrice.upsert({
      where: { planId_currencyId: { planId: plan.id, currencyId: ngn.id } },
      create: { planId: plan.id, currencyId: ngn.id, amount: 29_000_000, providerPlanId: 'PLN_e2e_ngn' },
      update: { amount: 29_000_000, providerPlanId: 'PLN_e2e_ngn' },
    });
  });

  beforeEach(async () => {
    await resetDatabase(prisma, redis);
    jest.clearAllMocks();
    fakeApiClient.initializeTransaction.mockResolvedValue({
      authorizationUrl: 'https://checkout.paystack.com/fake-session',
      accessCode: 'access_fake',
      reference: 'txn-fake-reference',
    });

    // resetDatabase() never touches Currency/PlanPrice/CurrencyCountryMapping/
    // Plan rows (shared seed-managed reference data — see setup-app.ts's
    // own rationale for Plan/PlatformRole) — clean up only this file's
    // own ad-hoc scratch rows, same pattern roles-and-permissions
    // .e2e-spec.ts established for its custom roles. Never deletes the
    // e2e-currency-plan row itself or its NGN price (created once in
    // beforeAll, before the plan cache warmed — see that comment).
    await prisma.currencyCountryMapping.deleteMany({ where: { countryCode: 'ZZ' } });
    await prisma.currency.deleteMany({ where: { code: 'ZZT' } });
  });

  afterAll(async () => {
    await resetDatabase(prisma, redis);
    await prisma.currencyCountryMapping.deleteMany({ where: { countryCode: 'ZZ' } });
    await prisma.planPrice.deleteMany({ where: { plan: { slug: 'e2e-currency-plan' } } });
    await prisma.currency.deleteMany({ where: { code: 'ZZT' } });
    await prisma.plan.deleteMany({ where: { slug: 'e2e-currency-plan' } });
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

  async function superAdmin(email: string) {
    const admin = await registerUser(email);
    await prisma.user.update({
      where: { id: admin.userId },
      data: { globalRole: GlobalRole.SUPER_ADMIN },
    });
    return admin;
  }

  function headers(actor: { accessToken: string }) {
    return { Authorization: `Bearer ${actor.accessToken}` };
  }

  async function currencyId(code: string): Promise<string> {
    const currency = await prisma.currency.findUniqueOrThrow({ where: { code } });
    return currency.id;
  }

  async function testPlanId(): Promise<string> {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { slug: 'e2e-currency-plan' } });
    return plan.id;
  }

  describe('Admin currency catalogue — SUPER_ADMIN protection', () => {
    it('denies unauthenticated requests with 401', async () => {
      await request(server).get('/api/v1/admin/currencies').expect(401);
      await request(server).post('/api/v1/admin/currencies').send({}).expect(401);
    });

    it('denies a normal platform user with 403 on every mutation', async () => {
      const user = await registerUser('probe-currency@example.com');

      await request(server).get('/api/v1/admin/currencies').set(headers(user)).expect(403);
      await request(server)
        .post('/api/v1/admin/currencies')
        .set(headers(user))
        .send({ code: 'ZZT', name: 'Test Coin', symbol: 'Z' })
        .expect(403);
      await request(server)
        .patch('/api/v1/admin/currencies/settings')
        .set(headers(user))
        .send({ autoDetectEnabled: false })
        .expect(403);
    });
  });

  describe('Admin: create, activate/deactivate currency', () => {
    it('creates a new currency', async () => {
      const admin = await superAdmin('admin-create-currency@example.com');

      const res = await request(server)
        .post('/api/v1/admin/currencies')
        .set(headers(admin))
        .send({ code: 'zzt', name: 'Test Coin', symbol: 'Z', decimalPlaces: 2, region: 'Testland' });

      expect(res.status).toBe(201);
      expect(res.body.code).toBe('ZZT');
      expect(res.body.isActive).toBe(true);
    });

    it('rejects a duplicate currency code (409)', async () => {
      const admin = await superAdmin('admin-dup-currency@example.com');

      await request(server)
        .post('/api/v1/admin/currencies')
        .set(headers(admin))
        .send({ code: 'USD', name: 'US Dollar', symbol: '$' })
        .expect(409);
    });

    it('deactivates and reactivates a currency', async () => {
      const admin = await superAdmin('admin-toggle-currency@example.com');
      const czk = await currencyId('CZK');

      const deactivate = await request(server)
        .patch(`/api/v1/admin/currencies/${czk}`)
        .set(headers(admin))
        .send({ isActive: false });
      expect(deactivate.status).toBe(200);
      expect(deactivate.body.isActive).toBe(false);

      const reactivate = await request(server)
        .patch(`/api/v1/admin/currencies/${czk}`)
        .set(headers(admin))
        .send({ isActive: true });
      expect(reactivate.body.isActive).toBe(true);
    });

    it('rejects deactivating the platform default currency', async () => {
      const admin = await superAdmin('admin-default-currency@example.com');
      const settings = await request(server)
        .get('/api/v1/admin/currencies/settings')
        .set(headers(admin));

      const res = await request(server)
        .patch(`/api/v1/admin/currencies/${settings.body.defaultCurrencyId}`)
        .set(headers(admin))
        .send({ isActive: false });

      expect(res.status).toBe(400);
    });
  });

  describe('Admin: default/fallback currency + auto-detect settings', () => {
    it('changes the default and fallback currency, then restores USD', async () => {
      const admin = await superAdmin('admin-settings-currency@example.com');
      const dkk = await currencyId('DKK');
      const usd = await currencyId('USD');

      const res = await request(server)
        .patch('/api/v1/admin/currencies/settings')
        .set(headers(admin))
        .send({ defaultCurrencyId: dkk, fallbackCurrencyId: dkk });

      expect(res.status).toBe(200);
      expect(res.body.defaultCurrencyId).toBe(dkk);
      expect(res.body.fallbackCurrencyId).toBe(dkk);

      // CurrencySettings is a shared singleton across this whole suite —
      // restore it so later tests aren't affected.
      await request(server)
        .patch('/api/v1/admin/currencies/settings')
        .set(headers(admin))
        .send({ defaultCurrencyId: usd, fallbackCurrencyId: usd });
    });

    it('toggles automatic currency detection, then restores it', async () => {
      const admin = await superAdmin('admin-autodetect@example.com');

      const off = await request(server)
        .patch('/api/v1/admin/currencies/settings')
        .set(headers(admin))
        .send({ autoDetectEnabled: false });
      expect(off.body.autoDetectEnabled).toBe(false);

      const on = await request(server)
        .patch('/api/v1/admin/currencies/settings')
        .set(headers(admin))
        .send({ autoDetectEnabled: true });
      expect(on.body.autoDetectEnabled).toBe(true);
    });
  });

  describe('Admin: country -> currency mapping', () => {
    it('creates, updates, and deletes a country mapping', async () => {
      const admin = await superAdmin('admin-mapping@example.com');
      const ngn = await currencyId('NGN');
      const gbp = await currencyId('GBP');

      const create = await request(server)
        .post('/api/v1/admin/currencies/country-mappings')
        .set(headers(admin))
        .send({ countryCode: 'zz', countryName: 'Zzedland', currencyId: ngn });
      expect(create.status).toBe(201);
      expect(create.body.countryCode).toBe('ZZ');

      const update = await request(server)
        .patch(`/api/v1/admin/currencies/country-mappings/${create.body.id}`)
        .set(headers(admin))
        .send({ currencyId: gbp });
      expect(update.body.currencyId).toBe(gbp);

      const remove = await request(server)
        .delete(`/api/v1/admin/currencies/country-mappings/${create.body.id}`)
        .set(headers(admin));
      expect(remove.status).toBe(200);

      const list = await request(server)
        .get('/api/v1/admin/currencies/country-mappings')
        .set(headers(admin));
      expect(
        list.body.find((m: { countryCode: string }) => m.countryCode === 'ZZ'),
      ).toBeUndefined();
    });
  });

  describe('Public: currency catalogue + detection', () => {
    it('lists only active currencies', async () => {
      const res = await request(server).get('/api/v1/public/currencies');

      expect(res.status).toBe(200);
      expect(res.body.every((c: { isActive: boolean }) => c.isActive)).toBe(true);
      expect(res.body.some((c: { code: string }) => c.code === 'NGN')).toBe(true);
    });

    it('an explicit currency choice always wins', async () => {
      const res = await request(server).get('/api/v1/public/currencies/detect?currency=EUR');

      expect(res.status).toBe(200);
      expect(res.body.source).toBe('EXPLICIT');
      expect(res.body.currency.code).toBe('EUR');
    });

    it('falls back to the platform fallback/default currency when detection resolves nothing', async () => {
      // No X-Forwarded-For / plausible client IP in a supertest request
      // against a loopback connection — GeoIP resolves no country,
      // exactly like Sprint 16 §6's "handle... missing IP... gracefully".
      const res = await request(server).get('/api/v1/public/currencies/detect');

      expect(res.status).toBe(200);
      expect(['FALLBACK', 'IP_DETECTED']).toContain(res.body.source);
      expect(res.body.currency).toBeTruthy();
    });

    it('never fails the request over a malformed explicit currency', async () => {
      const res = await request(server).get(
        '/api/v1/public/currencies/detect?currency=NOT_A_REAL_CODE',
      );

      expect(res.status).toBe(200);
      expect(res.body.source).toBe('FALLBACK');
    });
  });

  describe('Authenticated: currency preference precedence', () => {
    it('an explicit persisted preference is readable back after being set', async () => {
      const user = await registerUser('pref-currency@example.com');

      const before = await request(server)
        .get('/api/v1/users/me/currency-preference')
        .set(headers(user));
      expect(before.body.currencyCode).toBeNull();

      const set = await request(server)
        .patch('/api/v1/users/me/currency-preference')
        .set(headers(user))
        .send({ currency: 'GBP' });
      expect(set.status).toBe(200);

      const after = await request(server)
        .get('/api/v1/users/me/currency-preference')
        .set(headers(user));
      expect(after.body.currencyCode).toBe('GBP');
    });

    it('clearing the preference removes it', async () => {
      const user = await registerUser('clear-pref-currency@example.com');
      await request(server)
        .patch('/api/v1/users/me/currency-preference')
        .set(headers(user))
        .send({ currency: 'EUR' });

      const cleared = await request(server)
        .delete('/api/v1/users/me/currency-preference')
        .set(headers(user));
      expect(cleared.status).toBe(204);

      const after = await request(server)
        .get('/api/v1/users/me/currency-preference')
        .set(headers(user));
      expect(after.body.currencyCode).toBeNull();
    });

    it('rejects setting an inactive currency as a preference', async () => {
      const admin = await superAdmin('admin-inactive-pref@example.com');
      const user = await registerUser('inactive-pref-currency@example.com');
      const sek = await currencyId('SEK');
      await request(server)
        .patch(`/api/v1/admin/currencies/${sek}`)
        .set(headers(admin))
        .send({ isActive: false });

      const res = await request(server)
        .patch('/api/v1/users/me/currency-preference')
        .set(headers(user))
        .send({ currency: 'SEK' });
      expect(res.status).toBe(400);

      // restore
      await request(server)
        .patch(`/api/v1/admin/currencies/${sek}`)
        .set(headers(admin))
        .send({ isActive: true });
    });
  });

  describe('Plan currency pricing', () => {
    // Deliberately uses PLN/HUF (never touched by any other describe
    // block in this file) so adding/removing a price here can never
    // race with the NGN price the "Checkout currency validation" and
    // "Subscription currency preservation" blocks below depend on.

    it('a plan can have multiple currency prices', async () => {
      const admin = await superAdmin('admin-plan-price@example.com');
      const planId = await testPlanId();
      const pln = await currencyId('PLN');

      const res = await request(server)
        .post(`/api/v1/admin/plans/${planId}/prices`)
        .set(headers(admin))
        .send({ currencyId: pln, amount: 18_00 });

      expect(res.status).toBe(201);
      const prices = res.body.prices as Array<{ currencyCode: string; amount: number }>;
      expect(prices.some((p) => p.currencyCode === 'NGN')).toBe(true);
      expect(prices.some((p) => p.currencyCode === 'PLN' && p.amount === 1800)).toBe(true);

      // Clean up this test's own addition.
      await request(server)
        .delete(`/api/v1/admin/plans/${planId}/prices/${pln}`)
        .set(headers(admin));
    });

    it('adds then removes a currency price', async () => {
      const admin = await superAdmin('admin-remove-price@example.com');
      const planId = await testPlanId();
      const huf = await currencyId('HUF');

      await request(server)
        .post(`/api/v1/admin/plans/${planId}/prices`)
        .set(headers(admin))
        .send({ currencyId: huf, amount: 700_000 });

      const res = await request(server)
        .delete(`/api/v1/admin/plans/${planId}/prices/${huf}`)
        .set(headers(admin));

      expect(res.status).toBe(200);
      expect(
        res.body.prices.find((p: { currencyCode: string }) => p.currencyCode === 'HUF'),
      ).toBeUndefined();
      // The NGN price this file's other tests depend on is untouched.
      expect(
        res.body.prices.find((p: { currencyCode: string }) => p.currencyCode === 'NGN'),
      ).toBeTruthy();
    });

    it('rejects setting a price in an inactive currency', async () => {
      const admin = await superAdmin('admin-inactive-price@example.com');
      const planId = await testPlanId();
      const ron = await currencyId('RON');
      await request(server)
        .patch(`/api/v1/admin/currencies/${ron}`)
        .set(headers(admin))
        .send({ isActive: false });

      const res = await request(server)
        .post(`/api/v1/admin/plans/${planId}/prices`)
        .set(headers(admin))
        .send({ currencyId: ron, amount: 1000 });

      expect(res.status).toBe(400);

      await request(server)
        .patch(`/api/v1/admin/currencies/${ron}`)
        .set(headers(admin))
        .send({ isActive: true });
    });
  });

  describe('Checkout currency validation', () => {
    it('a successful checkout in a priced, provider-supported currency uses that currency plan_code', async () => {
      const owner = await registerUser('checkout-ngn@example.com');

      const res = await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/billing/subscribe`)
        .set(headers(owner))
        .send({ planSlug: 'e2e-currency-plan', currency: 'NGN' });

      expect(res.status).toBe(200);
      expect(res.body.checkoutUrl).toBeTruthy();
      expect(fakeApiClient.initializeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ planCode: 'PLN_e2e_ngn', amountKobo: 29_000_000 }),
      );
    });

    it('rejects a currency the plan has no price configured for (400), no checkout attempted', async () => {
      const owner = await registerUser('checkout-no-price@example.com');

      const res = await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/billing/subscribe`)
        .set(headers(owner))
        .send({ planSlug: 'e2e-currency-plan', currency: 'EUR' });

      expect(res.status).toBe(400);
      expect(fakeApiClient.initializeTransaction).not.toHaveBeenCalled();
    });

    it('rejects a currency the payment provider does not support, even though LinkIQ has it active and priced (400)', async () => {
      const admin = await superAdmin('admin-gbp-price@example.com');
      const planId = await testPlanId();
      const gbp = await currencyId('GBP');
      // GBP is active in LinkIQ and can be priced on this plan, but the
      // default PAYSTACK_SUPPORTED_CURRENCIES allowlist (NGN,USD) never
      // includes it — exactly the "LinkIQ currency status vs payment
      // provider currency capability" distinction from Sprint 16 §11.
      await request(server)
        .post(`/api/v1/admin/plans/${planId}/prices`)
        .set(headers(admin))
        .send({ currencyId: gbp, amount: 1500 });
      const owner = await registerUser('checkout-unsupported@example.com');

      const res = await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/billing/subscribe`)
        .set(headers(owner))
        .send({ planSlug: 'e2e-currency-plan', currency: 'GBP' });

      expect(res.status).toBe(400);
      expect(fakeApiClient.initializeTransaction).not.toHaveBeenCalled();

      await request(server)
        .delete(`/api/v1/admin/plans/${planId}/prices/${gbp}`)
        .set(headers(admin));
    });
  });

  describe('Subscription currency preservation (Sprint 16 §12)', () => {
    it("changing the user's currency preference never changes an existing subscription's recorded currency", async () => {
      const owner = await registerUser('preserve-currency@example.com');

      // Free-plan default subscription is USD/0 from workspace creation.
      const before = await request(server)
        .get(`/api/v1/workspaces/${owner.workspaceId}/billing`)
        .set(headers(owner));
      expect(before.body.subscription.currency).toBe('USD');

      await request(server)
        .patch('/api/v1/users/me/currency-preference')
        .set(headers(owner))
        .send({ currency: 'NGN' });

      const after = await request(server)
        .get(`/api/v1/workspaces/${owner.workspaceId}/billing`)
        .set(headers(owner));
      expect(after.body.subscription.currency).toBe('USD');
    });
  });

  describe('Audit records', () => {
    it('records audit entries for currency creation, settings changes, and country mapping changes', async () => {
      const admin = await superAdmin('admin-audit-currency@example.com');
      const ngn = await currencyId('NGN');

      await request(server)
        .post('/api/v1/admin/currencies')
        .set(headers(admin))
        .send({ code: 'ZZT', name: 'Test Coin', symbol: 'Z' });
      await request(server)
        .post('/api/v1/admin/currencies/country-mappings')
        .set(headers(admin))
        .send({ countryCode: 'ZZ', countryName: 'Zzedland', currencyId: ngn });

      const logs = await request(server)
        .get('/api/v1/admin/audit-logs')
        .query({ page: 1, pageSize: 50, search: 'currency' })
        .set(headers(admin));

      const actions = logs.body.items.map((entry: { action: string }) => entry.action);
      expect(actions).toContain('admin.currency_created');
      expect(actions).toContain('admin.currency_country_mapping_created');
    });
  });
});
