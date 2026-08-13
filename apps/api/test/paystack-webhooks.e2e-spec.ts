// Set BEFORE createTestApp() compiles AppModule (ConfigModule reads
// process.env at that compile call) — same pattern webhooks.e2e-spec.ts
// already establishes for its own env overrides. A fixed test secret
// lets this file compute real HMAC-SHA512 signatures without ever
// touching Paystack's real network — no real Paystack calls happen
// anywhere in this suite, per docs/architecture/paystack-integration.md
// §Test strategy.
process.env.PAYSTACK_SECRET_KEY = 'sk_test_e2e_secret';

import { createHmac } from 'crypto';

import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import request from 'supertest';

import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

function sign(
  rawBody: string,
  secret = process.env.PAYSTACK_SECRET_KEY!,
): string {
  return createHmac('sha512', secret).update(rawBody).digest('hex');
}

/** Sends a raw, pre-serialized JSON string as the exact request body —
 * critical here: signing must happen over the SAME bytes the server
 * receives. Passing a plain object to supertest's .send() would let
 * superagent re-serialize it independently, risking a byte mismatch
 * (key order, whitespace) that would make even a genuinely valid
 * signature fail — see PaystackSignatureService's own docs on this
 * exact risk. */
function postWebhook(
  server: Parameters<typeof request>[0],
  rawBody: string,
  signature: string | undefined,
) {
  const req = request(server)
    .post('/api/v1/webhooks/paystack')
    .set('Content-Type', 'application/json');
  if (signature !== undefined) {
    req.set('x-paystack-signature', signature);
  }
  return req.send(rawBody);
}

describe('Paystack Webhooks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let server: Parameters<typeof request>[0];

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    redis = testApp.redis;
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(prisma, redis);
    // BillingEvent has no workspace FK (it's provider-global) so
    // resetDatabase()'s workspace-cascade cleanup never touches it.
    await prisma.billingEvent.deleteMany({ where: { provider: 'paystack' } });
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

  /** Polls until the workspace's Subscription row satisfies `predicate`,
   * or times out — the async BullMQ processing pipeline needs this the
   * same way webhooks.e2e-spec.ts polls for delivery rows. */
  async function waitForSubscription(
    workspaceId: string,
    predicate: (
      sub: {
        status: string;
        provider: string | null;
        cancelAt: Date | null;
        providerSubscriptionId: string | null;
      } | null,
    ) => boolean,
    timeoutMs = 8000,
  ) {
    const deadline = Date.now() + timeoutMs;
    let sub: Awaited<ReturnType<typeof prisma.subscription.findUnique>> = null;
    while (Date.now() < deadline) {
      sub = await prisma.subscription.findUnique({ where: { workspaceId } });
      if (predicate(sub)) return sub;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return sub;
  }

  async function waitForBillingEventProcessed(
    externalEventId: string,
    timeoutMs = 8000,
  ) {
    const deadline = Date.now() + timeoutMs;
    let event: { status: string } | null = null;
    while (Date.now() < deadline) {
      event = await prisma.billingEvent.findUnique({
        where: {
          provider_externalEventId: { provider: 'paystack', externalEventId },
        },
      });
      if (event && event.status !== 'PENDING') return event;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return event;
  }

  describe('signature verification', () => {
    it('rejects a request with no signature header (401)', async () => {
      const rawBody = JSON.stringify({ event: 'charge.success', data: {} });

      const res = await postWebhook(server, rawBody, undefined);

      expect(res.status).toBe(401);
      const count = await prisma.billingEvent.count({
        where: { provider: 'paystack' },
      });
      expect(count).toBe(0);
    });

    it('rejects a request signed with the wrong secret (401)', async () => {
      const rawBody = JSON.stringify({ event: 'charge.success', data: {} });
      const badSignature = sign(rawBody, 'sk_test_wrong_secret');

      const res = await postWebhook(server, rawBody, badSignature);

      expect(res.status).toBe(401);
    });

    it('rejects a request with a signature computed over a different body (tampered payload)', async () => {
      const signedBody = JSON.stringify({
        event: 'charge.success',
        data: { amount: 1000 },
      });
      const signature = sign(signedBody);
      const tamperedBody = JSON.stringify({
        event: 'charge.success',
        data: { amount: 100000 },
      });

      const res = await postWebhook(server, tamperedBody, signature);

      expect(res.status).toBe(401);
    });

    it('accepts a correctly-signed request (200)', async () => {
      const rawBody = JSON.stringify({
        event: 'subscription.expiring_cards',
        data: {},
      });
      const signature = sign(rawBody);

      const res = await postWebhook(server, rawBody, signature);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });
    });
  });

  describe('charge.success', () => {
    it('activates the subscription, stamps providerCustomerId, and records a PAID invoice', async () => {
      const owner = await registerUser('paystack-charge1@example.com');
      const payload = {
        event: 'charge.success',
        data: {
          metadata: { workspaceId: owner.workspaceId, planSlug: 'starter' },
          customer: { customer_code: 'CUS_e2e_1' },
          reference: 'txn-e2e-1',
          amount: 190000,
          currency: 'USD',
        },
      };
      const rawBody = JSON.stringify(payload);
      const signature = sign(rawBody);

      const res = await postWebhook(server, rawBody, signature);
      expect(res.status).toBe(200);

      // The workspace's default FREE subscription is already ACTIVE at
      // registration time — poll on `provider` instead, which only gets
      // stamped once the charge.success handler actually runs.
      const sub = await waitForSubscription(
        owner.workspaceId,
        (s) => s?.provider === 'paystack',
      );
      expect(sub).toMatchObject({ status: 'ACTIVE', provider: 'paystack' });

      const fullSub = await prisma.subscription.findUnique({
        where: { workspaceId: owner.workspaceId },
        include: { plan: true },
      });
      expect(fullSub?.plan.slug).toBe('starter');
      expect(fullSub?.provider).toBe('paystack');
      expect(fullSub?.providerCustomerId).toBe('CUS_e2e_1');

      const invoices = await prisma.invoice.findMany({
        where: { workspaceId: owner.workspaceId },
      });
      expect(invoices).toHaveLength(1);
      expect(invoices[0]).toMatchObject({
        status: 'PAID',
        amount: 190000,
        providerInvoiceId: 'txn-e2e-1',
      });
    });

    it('a byte-identical redelivery is idempotent (deduped, not double-processed)', async () => {
      const owner = await registerUser('paystack-charge2@example.com');
      const payload = {
        event: 'charge.success',
        data: {
          metadata: { workspaceId: owner.workspaceId, planSlug: 'starter' },
          customer: { customer_code: 'CUS_e2e_2' },
          reference: 'txn-e2e-2',
          amount: 190000,
          currency: 'USD',
        },
      };
      const rawBody = JSON.stringify(payload);
      const signature = sign(rawBody);

      await postWebhook(server, rawBody, signature).expect(200);
      const firstEvents = await prisma.billingEvent.findMany({
        where: { provider: 'paystack' },
      });
      expect(firstEvents).toHaveLength(1);
      await waitForBillingEventProcessed(firstEvents[0]!.externalEventId);

      // Redeliver the exact same bytes (Paystack's own retry-on-missed-ack
      // behavior) — must be a pure no-op, not a second invoice.
      const res2 = await postWebhook(server, rawBody, signature);
      expect(res2.status).toBe(200);

      const events = await prisma.billingEvent.findMany({
        where: { provider: 'paystack' },
      });
      expect(events).toHaveLength(1);

      const invoices = await prisma.invoice.findMany({
        where: { workspaceId: owner.workspaceId },
      });
      expect(invoices).toHaveLength(1);
    });

    it('is recorded but marked FAILED when metadata cannot be correlated to any workspace', async () => {
      const payload = {
        event: 'charge.success',
        data: {
          metadata: {
            workspaceId: '00000000-0000-0000-0000-000000000000',
            planSlug: 'starter',
          },
          customer: { customer_code: 'CUS_e2e_orphan' },
          reference: 'txn-e2e-orphan',
          amount: 190000,
        },
      };
      const rawBody = JSON.stringify(payload);
      const signature = sign(rawBody);

      await postWebhook(server, rawBody, signature).expect(200);

      const event = await prisma.billingEvent.findFirst({
        where: { provider: 'paystack' },
      });
      const processed = await waitForBillingEventProcessed(
        event!.externalEventId,
      );
      expect(processed?.status).toBe('FAILED');
    });
  });

  describe('subscription.create', () => {
    it('correlates via metadata.workspaceId and stamps providerSubscriptionId/providerPriceId', async () => {
      const owner = await registerUser('paystack-subcreate1@example.com');
      // subscription.create only fills in the subscription-level fields —
      // it doesn't itself flip status/plan (that's charge.success's job),
      // so seed a minimal ACTIVE-on-starter state directly to isolate
      // this handler's own behavior.
      await prisma.subscription.update({
        where: { workspaceId: owner.workspaceId },
        data: { provider: 'paystack', providerCustomerId: 'CUS_e2e_3' },
      });

      const payload = {
        event: 'subscription.create',
        data: {
          subscription_code: 'SUB_e2e_1',
          email_token: 'tok_e2e_1',
          metadata: { workspaceId: owner.workspaceId },
          customer: { customer_code: 'CUS_e2e_3' },
          plan: { plan_code: 'PLN_starter' },
          next_payment_date: '2026-09-13T10:00:00.000Z',
        },
      };
      const rawBody = JSON.stringify(payload);
      const signature = sign(rawBody);

      await postWebhook(server, rawBody, signature).expect(200);

      const sub = await waitForSubscription(
        owner.workspaceId,
        (s) => s !== null && s.providerSubscriptionId !== null,
      );
      expect(sub).not.toBeNull();
      const fullSub = await prisma.subscription.findUnique({
        where: { workspaceId: owner.workspaceId },
      });
      expect(fullSub?.providerSubscriptionId).toBe('SUB_e2e_1:tok_e2e_1');
      expect(fullSub?.providerPriceId).toBe('PLN_starter');
      expect(fullSub?.currentPeriodEnd?.toISOString()).toBe(
        '2026-09-13T10:00:00.000Z',
      );
    });
  });

  describe('subscription.disable', () => {
    it('does not touch a subscription whose cancelAt is already set (LinkIQ-initiated, confirmation echo)', async () => {
      const owner = await registerUser('paystack-disable1@example.com');
      const cancelAt = new Date(Date.now() + 86_400_000);
      await prisma.subscription.update({
        where: { workspaceId: owner.workspaceId },
        data: {
          provider: 'paystack',
          providerSubscriptionId: 'SUB_e2e_2:tok_e2e_2',
          cancelAt,
          canceledAt: new Date(),
        },
      });

      const payload = {
        event: 'subscription.disable',
        data: { subscription_code: 'SUB_e2e_2' },
      };
      const rawBody = JSON.stringify(payload);
      const signature = sign(rawBody);

      const res = await postWebhook(server, rawBody, signature);
      expect(res.status).toBe(200);

      const event = await prisma.billingEvent.findFirst({
        where: { provider: 'paystack' },
      });
      await waitForBillingEventProcessed(event!.externalEventId);

      const fullSub = await prisma.subscription.findUnique({
        where: { workspaceId: owner.workspaceId },
      });
      expect(fullSub?.cancelAt?.toISOString()).toBe(cancelAt.toISOString());
    });

    it('applies cancelAt for a provider-initiated disable LinkIQ never requested', async () => {
      const owner = await registerUser('paystack-disable2@example.com');
      await prisma.subscription.update({
        where: { workspaceId: owner.workspaceId },
        data: {
          provider: 'paystack',
          providerSubscriptionId: 'SUB_e2e_3:tok_e2e_3',
          cancelAt: null,
        },
      });

      const payload = {
        event: 'subscription.disable',
        data: { subscription_code: 'SUB_e2e_3' },
      };
      const rawBody = JSON.stringify(payload);
      const signature = sign(rawBody);

      await postWebhook(server, rawBody, signature).expect(200);

      const sub = await waitForSubscription(
        owner.workspaceId,
        (s) => s !== null && s.cancelAt !== null,
      );
      expect(sub).not.toBeNull();
    });
  });

  describe('invoice.payment_failed', () => {
    it('sets PAST_DUE and records an UNCOLLECTIBLE invoice', async () => {
      const owner = await registerUser('paystack-failed1@example.com');
      await prisma.subscription.update({
        where: { workspaceId: owner.workspaceId },
        data: {
          provider: 'paystack',
          providerCustomerId: 'CUS_e2e_4',
          status: 'ACTIVE',
        },
      });

      const payload = {
        event: 'invoice.payment_failed',
        data: {
          customer: { customer_code: 'CUS_e2e_4' },
          amount: 190000,
          currency: 'USD',
          gateway_response: 'Insufficient funds',
        },
      };
      const rawBody = JSON.stringify(payload);
      const signature = sign(rawBody);

      await postWebhook(server, rawBody, signature).expect(200);

      const sub = await waitForSubscription(
        owner.workspaceId,
        (s) => s?.status === 'PAST_DUE',
      );
      expect(sub).toMatchObject({ status: 'PAST_DUE' });

      const invoices = await prisma.invoice.findMany({
        where: { workspaceId: owner.workspaceId },
      });
      expect(invoices).toHaveLength(1);
      expect(invoices[0]).toMatchObject({
        status: 'UNCOLLECTIBLE',
        failureReason: 'Insufficient funds',
      });
    });
  });

  describe('unrecognized event types', () => {
    it('is recorded (200) but processed as a no-op — no subscription mutation', async () => {
      const owner = await registerUser('paystack-unrecognized1@example.com');
      const before = await prisma.subscription.findUnique({
        where: { workspaceId: owner.workspaceId },
      });

      const payload = {
        event: 'refund.processed',
        data: { metadata: { workspaceId: owner.workspaceId } },
      };
      const rawBody = JSON.stringify(payload);
      const signature = sign(rawBody);

      await postWebhook(server, rawBody, signature).expect(200);

      const event = await prisma.billingEvent.findFirst({
        where: { provider: 'paystack' },
      });
      const processed = await waitForBillingEventProcessed(
        event!.externalEventId,
      );
      expect(processed?.status).toBe('PROCESSED');

      const after = await prisma.subscription.findUnique({
        where: { workspaceId: owner.workspaceId },
      });
      expect(after).toEqual(before);
    });
  });
});
