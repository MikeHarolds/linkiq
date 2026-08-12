import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import request from 'supertest';

import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

describe('Billing & Subscriptions (e2e)', () => {
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
  });

  afterAll(async () => {
    await resetDatabase(prisma, redis);
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

  function inviteMember(
    owner: { accessToken: string; workspaceId: string },
    email: string,
    role: 'ADMIN' | 'MEMBER' | 'VIEWER',
  ) {
    return request(server)
      .post(`/api/v1/workspaces/${owner.workspaceId}/members/invite`)
      .set(headers(owner))
      .send({ email, role });
  }

  /** Registers a fresh user and invites them into `owner`'s workspace at
   * the given role — the standard "second actor with a specific role"
   * fixture used throughout this suite's RBAC tests. */
  async function registerAndInvite(
    owner: { accessToken: string; workspaceId: string },
    email: string,
    role: 'ADMIN' | 'MEMBER' | 'VIEWER',
  ) {
    const actor = await registerUser(email);
    await inviteMember(owner, email, role).expect(201);
    return actor;
  }

  function createDomain(
    owner: { accessToken: string; workspaceId: string },
    domain: string,
  ) {
    return request(server)
      .post(`/api/v1/workspaces/${owner.workspaceId}/domains`)
      .set(headers(owner))
      .send({ domain });
  }

  function createCampaign(
    owner: { accessToken: string; workspaceId: string },
    name: string,
  ) {
    return request(server)
      .post('/api/v1/campaigns')
      .set({ ...headers(owner), 'X-Workspace-Id': owner.workspaceId })
      .send({ name });
  }

  function createLink(
    owner: { accessToken: string; workspaceId: string },
    payload: Record<string, unknown>,
  ) {
    return request(server)
      .post('/api/v1/links')
      .set({ ...headers(owner), 'X-Workspace-Id': owner.workspaceId })
      .send(payload);
  }

  function createQrCode(
    owner: { accessToken: string; workspaceId: string },
    linkId: string,
    name: string,
  ) {
    return request(server)
      .post(`/api/v1/links/${linkId}/qrcodes`)
      .set({ ...headers(owner), 'X-Workspace-Id': owner.workspaceId })
      .send({ name });
  }

  describe('default subscription on workspace creation', () => {
    it('a freshly registered workspace has an ACTIVE FREE subscription', async () => {
      const owner = await registerUser('signup1@example.com');

      const res = await request(server)
        .get(billingBase(owner.workspaceId))
        .set(headers(owner));

      expect(res.status).toBe(200);
      expect(res.body.plan.slug).toBe('free');
      expect(res.body.subscription).not.toBeNull();
      expect(res.body.subscription.status).toBe('ACTIVE');
      expect(res.body.subscription.effectiveStatus).toBe('ACTIVE');
      expect(res.body.invoiceCount).toBe(0);
    });
  });

  describe('GET billing summary / usage / plans / invoices', () => {
    it('returns a usage snapshot covering every metered key', async () => {
      const owner = await registerUser('summary1@example.com');

      const res = await request(server)
        .get(`${billingBase(owner.workspaceId)}/usage`)
        .set(headers(owner));

      expect(res.status).toBe(200);
      const keys = res.body.map((u: { key: string }) => u.key);
      expect(keys).toEqual(
        expect.arrayContaining([
          'MAX_LINKS',
          'MAX_QR_CODES',
          'MAX_CAMPAIGNS',
          'MAX_CUSTOM_DOMAINS',
          'MAX_TEAM_MEMBERS',
          'MONTHLY_CLICKS',
        ]),
      );
    });

    it('lists every active plan with its limits', async () => {
      const owner = await registerUser('summary2@example.com');

      const res = await request(server)
        .get(`${billingBase(owner.workspaceId)}/plans`)
        .set(headers(owner));

      expect(res.status).toBe(200);
      expect(res.body.map((p: { slug: string }) => p.slug)).toEqual(
        expect.arrayContaining(['free', 'starter', 'professional', 'business', 'enterprise']),
      );
    });

    it('returns an empty invoice list for a workspace that never paid anything', async () => {
      const owner = await registerUser('summary3@example.com');

      const res = await request(server)
        .get(`${billingBase(owner.workspaceId)}/invoices`)
        .set(headers(owner));

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('a VIEWER can read billing information', async () => {
      const owner = await registerUser('summary4a@example.com');
      const viewer = await registerAndInvite(owner, 'summary4b@example.com', 'VIEWER');

      const res = await request(server)
        .get(billingBase(owner.workspaceId))
        .set(headers(viewer));

      expect(res.status).toBe(200);
    });
  });

  describe('workspace isolation', () => {
    it("a non-member cannot view another workspace's billing (403)", async () => {
      const owner = await registerUser('iso1a@example.com');
      const outsider = await registerUser('iso1b@example.com');

      const res = await request(server)
        .get(billingBase(owner.workspaceId))
        .set(headers(outsider));

      expect(res.status).toBe(403);
    });

    it("a non-member cannot subscribe/change-plan/cancel/reactivate on another workspace (403)", async () => {
      const owner = await registerUser('iso2a@example.com');
      const outsider = await registerUser('iso2b@example.com');
      const base = billingBase(owner.workspaceId);

      await request(server).post(`${base}/subscribe`).set(headers(outsider)).send({ planSlug: 'starter' }).expect(403);
      await request(server).post(`${base}/change-plan`).set(headers(outsider)).send({ planSlug: 'starter' }).expect(403);
      await request(server).post(`${base}/cancel`).set(headers(outsider)).expect(403);
      await request(server).post(`${base}/reactivate`).set(headers(outsider)).expect(403);
    });
  });

  describe('RBAC — MEMBER cannot manage billing, ADMIN/OWNER can', () => {
    it('a MEMBER can view billing but cannot subscribe (403)', async () => {
      const owner = await registerUser('rbac1a@example.com');
      const member = await registerAndInvite(owner, 'rbac1b@example.com', 'MEMBER');
      const base = billingBase(owner.workspaceId);

      await request(server).get(base).set(headers(member)).expect(200);
      const res = await request(server)
        .post(`${base}/subscribe`)
        .set(headers(member))
        .send({ planSlug: 'starter' });
      expect(res.status).toBe(403);
    });

    it('an ADMIN can subscribe on behalf of the workspace', async () => {
      const owner = await registerUser('rbac2a@example.com');
      const admin = await registerAndInvite(owner, 'rbac2b@example.com', 'ADMIN');

      const res = await request(server)
        .post(`${billingBase(owner.workspaceId)}/subscribe`)
        .set(headers(admin))
        .send({ planSlug: 'starter' });

      expect(res.status).toBe(200);
      expect(res.body.plan.slug).toBe('starter');
    });

    it('the OWNER can manage billing directly', async () => {
      const owner = await registerUser('rbac3@example.com');

      const res = await request(server)
        .post(`${billingBase(owner.workspaceId)}/change-plan`)
        .set(headers(owner))
        .send({ planSlug: 'starter' });

      expect(res.status).toBe(200);
      expect(res.body.plan.slug).toBe('starter');
    });
  });

  describe('subscription lifecycle', () => {
    it('subscribing to a plan with a trial starts it TRIALING', async () => {
      const owner = await registerUser('lifecycle1@example.com');

      const res = await request(server)
        .post(`${billingBase(owner.workspaceId)}/subscribe`)
        .set(headers(owner))
        .send({ planSlug: 'starter' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('TRIALING');
      expect(res.body.effectiveStatus).toBe('TRIALING');
      expect(res.body.trial).not.toBeNull();
      expect(res.body.trial.end).not.toBeNull();
    });

    it('changing plans resets status to ACTIVE and clears any pending cancellation', async () => {
      const owner = await registerUser('lifecycle2@example.com');
      await request(server)
        .post(`${billingBase(owner.workspaceId)}/subscribe`)
        .set(headers(owner))
        .send({ planSlug: 'starter' })
        .expect(200);

      const res = await request(server)
        .post(`${billingBase(owner.workspaceId)}/change-plan`)
        .set(headers(owner))
        .send({ planSlug: 'professional' });

      expect(res.status).toBe(200);
      expect(res.body.plan.slug).toBe('professional');
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.cancellation).toBeNull();
    });

    it('canceling schedules cancelAt at the end of the period without immediately revoking access', async () => {
      const owner = await registerUser('lifecycle3@example.com');
      // A subscribed (not default-FREE) subscription has a real
      // currentPeriodEnd to schedule the cancellation against — the
      // default FREE subscription has none, so cancel() falls back to
      // "now" for it (see SubscriptionsService.cancel), which is exactly
      // correct there but not what this test is exercising.
      await request(server)
        .post(`${billingBase(owner.workspaceId)}/subscribe`)
        .set(headers(owner))
        .send({ planSlug: 'starter' })
        .expect(200);

      const res = await request(server)
        .post(`${billingBase(owner.workspaceId)}/cancel`)
        .set(headers(owner));

      expect(res.status).toBe(200);
      expect(res.body.cancellation).not.toBeNull();
      expect(res.body.cancellation.cancelAt).not.toBeNull();
      // Access continues: the effective status has not flipped to CANCELED
      // yet because cancelAt is in the future.
      expect(res.body.effectiveStatus).not.toBe('CANCELED');
    });

    it('reactivating clears a pending cancellation', async () => {
      const owner = await registerUser('lifecycle4@example.com');
      await request(server)
        .post(`${billingBase(owner.workspaceId)}/subscribe`)
        .set(headers(owner))
        .send({ planSlug: 'starter' })
        .expect(200);
      await request(server)
        .post(`${billingBase(owner.workspaceId)}/cancel`)
        .set(headers(owner))
        .expect(200);

      const res = await request(server)
        .post(`${billingBase(owner.workspaceId)}/reactivate`)
        .set(headers(owner));

      expect(res.status).toBe(200);
      expect(res.body.cancellation).toBeNull();
    });

    it('reactivating with no pending cancellation is rejected (400)', async () => {
      const owner = await registerUser('lifecycle5@example.com');

      const res = await request(server)
        .post(`${billingBase(owner.workspaceId)}/reactivate`)
        .set(headers(owner));

      expect(res.status).toBe(400);
    });

    it('rejects subscribing to an unknown plan slug (404)', async () => {
      const owner = await registerUser('lifecycle6@example.com');

      const res = await request(server)
        .post(`${billingBase(owner.workspaceId)}/subscribe`)
        .set(headers(owner))
        .send({ planSlug: 'does-not-exist' });

      expect(res.status).toBe(404);
    });

    it('records audit events across the subscription lifecycle', async () => {
      const owner = await registerUser('lifecycle7@example.com');
      const base = billingBase(owner.workspaceId);
      await request(server).post(`${base}/subscribe`).set(headers(owner)).send({ planSlug: 'starter' });
      await request(server).post(`${base}/change-plan`).set(headers(owner)).send({ planSlug: 'professional' });
      await request(server).post(`${base}/cancel`).set(headers(owner));
      await request(server).post(`${base}/reactivate`).set(headers(owner));

      const actions = (
        await prisma.auditLog.findMany({
          where: { workspaceId: owner.workspaceId },
          orderBy: { createdAt: 'asc' },
        })
      ).map((a) => a.action);

      expect(actions).toEqual(
        expect.arrayContaining([
          'subscription.created',
          'billing.trial_started',
          'billing.plan_changed',
          'subscription.canceled',
          'subscription.reactivated',
        ]),
      );
    });
  });

  describe('plan limit enforcement', () => {
    it('blocks creating a 4th custom domain once the FREE plan limit (3) is reached, with a structured 403', async () => {
      const owner = await registerUser('limit1@example.com');
      await createDomain(owner, 'first.acme.com').expect(201);
      await createDomain(owner, 'second.acme.com').expect(201);
      await createDomain(owner, 'third.acme.com').expect(201);

      const res = await createDomain(owner, 'blocked.acme.com');

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        code: 'PLAN_LIMIT_REACHED',
        feature: 'custom domains',
        limit: 3,
        usage: 3,
      });
    });

    it('blocks creating a 4th campaign once the FREE plan limit (3) is reached', async () => {
      const owner = await registerUser('limit2@example.com');
      await createCampaign(owner, 'Campaign 1').expect(201);
      await createCampaign(owner, 'Campaign 2').expect(201);
      await createCampaign(owner, 'Campaign 3').expect(201);

      const res = await createCampaign(owner, 'Campaign 4');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
      expect(res.body.feature).toBe('campaigns');
    });

    it('blocks inviting a member once the FREE plan team-member limit (3) is reached', async () => {
      const owner = await registerUser('limit3a@example.com');
      // Owner counts as member #1.
      await registerAndInvite(owner, 'limit3b@example.com', 'MEMBER'); // #2
      await registerAndInvite(owner, 'limit3c@example.com', 'MEMBER'); // #3

      await registerUser('limit3d@example.com');
      const res = await inviteMember(owner, 'limit3d@example.com', 'MEMBER');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
      expect(res.body.feature).toBe('team members');
    });

    it('blocks creating a link once the FREE plan link limit (25) is reached, without disturbing the existing 25', async () => {
      const owner = await registerUser('limit4@example.com');
      await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          prisma.link.create({
            data: {
              workspaceId: owner.workspaceId,
              destinationUrl: `https://example.com/seed-${i}`,
              shortCode: `limit4-seed-${i}-${Date.now()}`,
            },
          }),
        ),
      );

      const res = await createLink(owner, {
        destinationUrl: 'https://example.com/one-too-many',
        slug: `limit4-overflow-${Date.now()}`,
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
      expect(res.body.feature).toBe('links');

      const count = await prisma.link.count({
        where: { workspaceId: owner.workspaceId },
      });
      expect(count).toBe(25);
    });

    it('blocks creating a QR code once the FREE plan QR limit (10) is reached', async () => {
      const owner = await registerUser('limit5@example.com');
      const link = await createLink(owner, {
        destinationUrl: 'https://example.com/qr-host',
        slug: `limit5-host-${Date.now()}`,
      });
      expect(link.status).toBe(201);

      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          prisma.qrCode.create({
            data: {
              workspaceId: owner.workspaceId,
              linkId: link.body.id,
              name: `Seed QR ${i}`,
            },
          }),
        ),
      );

      const res = await createQrCode(owner, link.body.id, 'One Too Many');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
      expect(res.body.feature).toBe('QR codes');
    });

    it('records a billing.limit_reached audit event when a limit blocks an action', async () => {
      const owner = await registerUser('limit6@example.com');
      await createDomain(owner, 'audited-1.acme.com').expect(201);
      await createDomain(owner, 'audited-2.acme.com').expect(201);
      await createDomain(owner, 'audited-3.acme.com').expect(201);
      await createDomain(owner, 'audited-block.acme.com').expect(403);

      const events = await prisma.auditLog.findMany({
        where: { workspaceId: owner.workspaceId, action: 'billing.limit_reached' },
      });
      expect(events.length).toBeGreaterThan(0);
    });

    it("an upgraded plan's higher limit immediately allows what the FREE plan blocked", async () => {
      const owner = await registerUser('limit7@example.com');
      await createDomain(owner, 'upgrade-1.acme.com').expect(201);
      await createDomain(owner, 'upgrade-2.acme.com').expect(201);
      await createDomain(owner, 'upgrade-3.acme.com').expect(201);
      await createDomain(owner, 'still-blocked.acme.com').expect(403);

      await request(server)
        .post(`${billingBase(owner.workspaceId)}/change-plan`)
        .set(headers(owner))
        .send({ planSlug: 'starter' })
        .expect(200);

      const res = await createDomain(owner, 'now-allowed.acme.com');
      expect(res.status).toBe(201);
    });
  });

  describe('billing limits never break existing functionality', () => {
    it('an existing link keeps redirecting after its workspace is over the link limit', async () => {
      const owner = await registerUser('regress1@example.com');
      const link = await createLink(owner, {
        destinationUrl: 'https://example.com/still-works',
        slug: `regress1-link-${Date.now()}`,
      });
      expect(link.status).toBe(201);

      // Push the workspace over its FREE link limit without touching the
      // link created above.
      await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          prisma.link.create({
            data: {
              workspaceId: owner.workspaceId,
              destinationUrl: `https://example.com/filler-${i}`,
              shortCode: `regress1-filler-${i}-${Date.now()}`,
            },
          }),
        ),
      );
      await createLink(owner, {
        destinationUrl: 'https://example.com/blocked',
        slug: `regress1-blocked-${Date.now()}`,
      }).expect(403);

      const res = await request(server)
        .get(`/${link.body.shortCode}`)
        .redirects(0);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://example.com/still-works');
    });

    it('a click on an existing link is still recorded while the workspace is over its link limit', async () => {
      const owner = await registerUser('regress2@example.com');
      const link = await createLink(owner, {
        destinationUrl: 'https://example.com/still-tracked',
        slug: `regress2-link-${Date.now()}`,
      });
      await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          prisma.link.create({
            data: {
              workspaceId: owner.workspaceId,
              destinationUrl: `https://example.com/filler2-${i}`,
              shortCode: `regress2-filler-${i}-${Date.now()}`,
            },
          }),
        ),
      );

      await request(server).get(`/${link.body.shortCode}`).redirects(0).expect(302);

      const deadline = Date.now() + 3000;
      let count = 0;
      while (Date.now() < deadline) {
        count = await prisma.clickEvent.count({ where: { linkId: link.body.id } });
        if (count > 0) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(count).toBe(1);
    });

    it("existing analytics endpoints keep working for a workspace over its link limit", async () => {
      const owner = await registerUser('regress3@example.com');
      await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          prisma.link.create({
            data: {
              workspaceId: owner.workspaceId,
              destinationUrl: `https://example.com/filler3-${i}`,
              shortCode: `regress3-filler-${i}-${Date.now()}`,
            },
          }),
        ),
      );

      const res = await request(server)
        .get('/api/v1/analytics/overview')
        .set({ ...headers(owner), 'X-Workspace-Id': owner.workspaceId });

      expect(res.status).toBe(200);
    });
  });
});
