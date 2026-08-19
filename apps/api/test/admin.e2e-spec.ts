import type { INestApplication } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import type { Redis } from 'ioredis';
import request from 'supertest';

import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

/**
 * Sprint 11 — Super Admin platform administration & operations.
 *
 * Covers the security-critical guarantee the sprint spec calls out
 * explicitly: SUPER_ADMIN is a platform-level role, wholly distinct from
 * workspace roles (OWNER/ADMIN/MEMBER/VIEWER), and every /admin API route
 * independently enforces it server-side — never via hidden navigation.
 * There is no self-service endpoint to grant SUPER_ADMIN (a deliberate
 * security choice — see super-admin.guard.ts's docs), so tests promote a
 * user the same way an operator would: a direct Prisma update after
 * registration. JwtStrategy re-fetches globalRole from the DB on every
 * request (see jwt.strategy.ts), so the already-issued access token
 * reflects the promotion on the very next call.
 */
describe('Super Admin Platform Administration (e2e)', () => {
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

  async function promoteToSuperAdmin(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { globalRole: GlobalRole.SUPER_ADMIN },
    });
  }

  async function inviteAsWorkspaceAdmin(
    owner: { accessToken: string },
    workspaceId: string,
    email: string,
  ) {
    await request(server)
      .post(`/api/v1/workspaces/${workspaceId}/members/invite`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email, role: 'ADMIN' })
      .expect(201);
  }

  function auth(actor: { accessToken: string }) {
    return { Authorization: `Bearer ${actor.accessToken}` };
  }

  describe('Access control matrix', () => {
    it('denies an unauthenticated request with 401', async () => {
      await request(server).get('/api/v1/admin/overview').expect(401);
    });

    it('denies a normal platform user (globalRole USER, OWNER of their own workspace) with 403', async () => {
      const user = await registerUser('normal-user@example.com');
      await request(server)
        .get('/api/v1/admin/overview')
        .set(auth(user))
        .expect(403);
    });

    it('denies a workspace ADMIN (workspace-privileged, not platform-privileged) with 403', async () => {
      const owner = await registerUser('owner-for-admin@example.com');
      const admin = await registerUser('workspace-admin@example.com');
      await inviteAsWorkspaceAdmin(
        owner,
        owner.workspaceId,
        'workspace-admin@example.com',
      );

      await request(server)
        .get('/api/v1/admin/overview')
        .set(auth(admin))
        .expect(403);
      await request(server)
        .get('/api/v1/admin/users')
        .set(auth(admin))
        .expect(403);
    });

    it('does not rely on navigation hiding — every /admin endpoint independently 403s a non-super-admin', async () => {
      const user = await registerUser('probe-user@example.com');
      const routes = [
        '/api/v1/admin/overview',
        '/api/v1/admin/users',
        '/api/v1/admin/workspaces',
        '/api/v1/admin/subscriptions',
        '/api/v1/admin/plans',
        '/api/v1/admin/payments',
        '/api/v1/admin/invoices',
        '/api/v1/admin/api-usage',
        '/api/v1/admin/webhooks/overview',
        '/api/v1/admin/domains',
        '/api/v1/admin/audit-logs',
        '/api/v1/admin/settings',
        '/api/v1/admin/settings/payments',
        '/api/v1/admin/system-health',
      ];

      for (const route of routes) {
        await request(server).get(route).set(auth(user)).expect(403);
      }
    });

    it('allows a SUPER_ADMIN through', async () => {
      const admin = await registerUser('super1@example.com');
      await promoteToSuperAdmin(admin.userId);

      await request(server)
        .get('/api/v1/admin/overview')
        .set(auth(admin))
        .expect(200);
    });
  });

  describe('SUPER_ADMIN can view every platform administration area', () => {
    async function superAdminAndTargetUser() {
      const admin = await registerUser('super2@example.com');
      await promoteToSuperAdmin(admin.userId);
      const target = await registerUser('target-user@example.com');
      return { admin, target };
    }

    it('can list users and view a specific user', async () => {
      const { admin, target } = await superAdminAndTargetUser();

      const list = await request(server)
        .get('/api/v1/admin/users')
        .set(auth(admin))
        .expect(200);
      expect(Array.isArray(list.body.items)).toBe(true);
      expect(
        list.body.items.some((u: { id: string }) => u.id === target.userId),
      ).toBe(true);

      const detail = await request(server)
        .get(`/api/v1/admin/users/${target.userId}`)
        .set(auth(admin))
        .expect(200);
      expect(detail.body.id).toBe(target.userId);
      expect(detail.body.workspaces.length).toBeGreaterThan(0);
    });

    it('can list workspaces and view workspace detail', async () => {
      const { admin, target } = await superAdminAndTargetUser();

      const list = await request(server)
        .get('/api/v1/admin/workspaces')
        .set(auth(admin))
        .expect(200);
      expect(
        list.body.items.some(
          (w: { id: string }) => w.id === target.workspaceId,
        ),
      ).toBe(true);

      const detail = await request(server)
        .get(`/api/v1/admin/workspaces/${target.workspaceId}`)
        .set(auth(admin))
        .expect(200);
      expect(detail.body.id).toBe(target.workspaceId);
      expect(Array.isArray(detail.body.members)).toBe(true);
      expect(Array.isArray(detail.body.apiKeys)).toBe(true);
    });

    it('can view subscriptions (every new workspace gets a default subscription)', async () => {
      const { admin, target } = await superAdminAndTargetUser();

      const list = await request(server)
        .get('/api/v1/admin/subscriptions')
        .set(auth(admin))
        .expect(200);
      expect(
        list.body.items.some(
          (s: { workspaceId: string }) => s.workspaceId === target.workspaceId,
        ),
      ).toBe(true);
    });

    it('can view plans', async () => {
      const { admin } = await superAdminAndTargetUser();
      const res = await request(server)
        .get('/api/v1/admin/plans')
        .set(auth(admin))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((p: { slug: string }) => p.slug === 'free')).toBe(
        true,
      );
    });

    it('can view payments and invoices (same underlying data, different presentation)', async () => {
      const { admin } = await superAdminAndTargetUser();
      const payments = await request(server)
        .get('/api/v1/admin/payments')
        .set(auth(admin))
        .expect(200);
      expect(Array.isArray(payments.body.items)).toBe(true);

      const invoices = await request(server)
        .get('/api/v1/admin/invoices')
        .set(auth(admin))
        .expect(200);
      expect(Array.isArray(invoices.body.items)).toBe(true);
    });

    it('can view API usage', async () => {
      const { admin } = await superAdminAndTargetUser();
      const res = await request(server)
        .get('/api/v1/admin/api-usage?range=30d')
        .set(auth(admin))
        .expect(200);
      expect(
        typeof res.body.totalRequests === 'number' ||
          res.body.totalRequests === undefined,
      ).toBe(true);
    });

    it('can view webhook operations (overview + endpoints)', async () => {
      const { admin } = await superAdminAndTargetUser();
      await request(server)
        .get('/api/v1/admin/webhooks/overview')
        .set(auth(admin))
        .expect(200);
      const endpoints = await request(server)
        .get('/api/v1/admin/webhooks/endpoints')
        .set(auth(admin))
        .expect(200);
      expect(Array.isArray(endpoints.body.items)).toBe(true);
    });

    it('can view domains', async () => {
      const { admin } = await superAdminAndTargetUser();
      const res = await request(server)
        .get('/api/v1/admin/domains')
        .set(auth(admin))
        .expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('can view audit logs, including its own SUPER_ADMIN actions', async () => {
      const { admin, target } = await superAdminAndTargetUser();

      await request(server)
        .post(`/api/v1/admin/users/${target.userId}/suspend`)
        .set(auth(admin))
        .expect(201);

      const logs = await request(server)
        .get('/api/v1/admin/audit-logs')
        .set(auth(admin))
        .expect(200);
      expect(
        logs.body.items.some(
          (l: { action: string; entityId: string }) =>
            l.action === 'admin.user_suspended' && l.entityId === target.userId,
        ),
      ).toBe(true);
    });

    it('can view platform settings and system health', async () => {
      const { admin } = await superAdminAndTargetUser();
      await request(server)
        .get('/api/v1/admin/settings')
        .set(auth(admin))
        .expect(200);
      await request(server)
        .get('/api/v1/admin/settings/payments')
        .set(auth(admin))
        .expect(200);
      await request(server)
        .get('/api/v1/admin/system-health')
        .set(auth(admin))
        .expect(200);
    });
  });

  describe('Sensitive data is never exposed', () => {
    it('never returns a plaintext password hash in the user list or detail', async () => {
      const admin = await registerUser('super3@example.com');
      await promoteToSuperAdmin(admin.userId);
      const target = await registerUser('secret-target@example.com');

      const list = await request(server)
        .get('/api/v1/admin/users')
        .set(auth(admin))
        .expect(200);
      expect(JSON.stringify(list.body)).not.toContain('passwordHash');

      const detail = await request(server)
        .get(`/api/v1/admin/users/${target.userId}`)
        .set(auth(admin))
        .expect(200);
      expect(JSON.stringify(detail.body)).not.toContain('passwordHash');
    });

    it('never returns the Paystack secret key — only a configured boolean and derived mode', async () => {
      const admin = await registerUser('super4@example.com');
      await promoteToSuperAdmin(admin.userId);

      const res = await request(server)
        .get('/api/v1/admin/settings/payments')
        .set(auth(admin))
        .expect(200);

      expect(res.body).toHaveProperty('secretKeyConfigured');
      expect(res.body).not.toHaveProperty('secretKey');
      const raw = JSON.stringify(res.body);
      expect(raw).not.toMatch(/sk_(test|live)_/);
    });

    it('never returns raw API key secrets in workspace detail — only safe metadata', async () => {
      const admin = await registerUser('super5@example.com');
      await promoteToSuperAdmin(admin.userId);
      const target = await registerUser('workspace-with-key@example.com');

      await request(server)
        .post(`/api/v1/workspaces/${target.workspaceId}/api-keys`)
        .set(auth(target))
        .send({ name: 'CI key', permissions: ['LINKS_READ'] })
        .expect(201);

      const detail = await request(server)
        .get(`/api/v1/admin/workspaces/${target.workspaceId}`)
        .set(auth(admin))
        .expect(200);

      expect(detail.body.apiKeys.length).toBeGreaterThan(0);
      for (const key of detail.body.apiKeys) {
        expect(key).not.toHaveProperty('hashedKey');
        expect(key).not.toHaveProperty('secret');
      }
    });
  });

  describe('Super Admin actions are themselves audited', () => {
    it('records admin.user_suspended, including the acting admin and target user', async () => {
      const admin = await registerUser('super6@example.com');
      await promoteToSuperAdmin(admin.userId);
      const target = await registerUser('to-be-suspended@example.com');

      await request(server)
        .post(`/api/v1/admin/users/${target.userId}/suspend`)
        .set(auth(admin))
        .expect(201);

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'admin.user_suspended', entityId: target.userId },
      });
      expect(entry).not.toBeNull();
      expect(entry?.userId).toBe(admin.userId);

      // The suspension is real, not just an audited no-op: login now fails.
      await request(server)
        .post('/api/v1/auth/login')
        .send({
          email: 'to-be-suspended@example.com',
          password: 'SecurePass123',
        })
        .expect(401);
    });

    it('a Super Admin cannot suspend their own account', async () => {
      const admin = await registerUser('super7@example.com');
      await promoteToSuperAdmin(admin.userId);

      await request(server)
        .post(`/api/v1/admin/users/${admin.userId}/suspend`)
        .set(auth(admin))
        .expect(400);
    });

    it('records admin.user_reactivated and admin.user_force_logout', async () => {
      const admin = await registerUser('super8@example.com');
      await promoteToSuperAdmin(admin.userId);
      const target = await registerUser('reactivate-target@example.com');

      await request(server)
        .post(`/api/v1/admin/users/${target.userId}/suspend`)
        .set(auth(admin))
        .expect(201);
      await request(server)
        .post(`/api/v1/admin/users/${target.userId}/reactivate`)
        .set(auth(admin))
        .expect(201);
      await request(server)
        .post(`/api/v1/admin/users/${target.userId}/force-logout`)
        .set(auth(admin))
        .expect(201);

      const [reactivated, forcedLogout] = await Promise.all([
        prisma.auditLog.findFirst({
          where: { action: 'admin.user_reactivated', entityId: target.userId },
        }),
        prisma.auditLog.findFirst({
          where: { action: 'admin.user_force_logout', entityId: target.userId },
        }),
      ]);
      expect(reactivated).not.toBeNull();
      expect(forcedLogout).not.toBeNull();
    });
  });

  /**
   * Sprint 18B §1/§2/§19 — the admin plan catalog's money handling.
   * `priceAmount` is always minor units at the DTO boundary (the web
   * admin UI converts a typed decimal to this via exact string
   * arithmetic — see packages/utils/src/format.ts — but the DTO/API
   * contract itself only ever accepts an integer); these tests exercise
   * that boundary directly over HTTP, independent of the frontend
   * conversion, and confirm no silent truncation/rounding happens
   * anywhere between the request body and the persisted+returned row.
   */
  describe('Plan pricing — NGN default and decimal-safe amounts (Sprint 18B)', () => {
    const scratchPlanSlugs = [
      'e2e-ngn-default-plan',
      'e2e-precise-amount-plan',
      'e2e-oversized-amount-plan',
      'e2e-decimal-amount-plan',
      'e2e-update-amount-plan',
    ];

    // resetDatabase() deliberately never touches Plan rows (shared
    // seed-managed reference data — see currency.e2e-spec.ts's own
    // rationale), so this file's own ad-hoc plans must be cleaned up
    // explicitly, both before (defensive, for a rerun after a killed
    // process) and after — same pattern as roles-and-permissions
    // .e2e-spec.ts's custom-plan cleanup.
    beforeAll(async () => {
      await prisma.plan.deleteMany({ where: { slug: { in: scratchPlanSlugs } } });
    });

    afterAll(async () => {
      await prisma.plan.deleteMany({ where: { slug: { in: scratchPlanSlugs } } });
    });

    async function superAdmin(email: string) {
      const admin = await registerUser(email);
      await promoteToSuperAdmin(admin.userId);
      return admin;
    }

    it('defaults a new plan to NGN when currency is omitted', async () => {
      const admin = await superAdmin('super-plan-1@example.com');

      const res = await request(server)
        .post('/api/v1/admin/plans')
        .set(auth(admin))
        .send({
          name: 'E2E NGN Default Plan',
          slug: 'e2e-ngn-default-plan',
          tier: 'STARTER',
          priceAmount: 1999,
        })
        .expect(201);

      expect(res.body.currency).toBe('NGN');
    });

    it('round-trips a large, non-trivial minor-unit amount exactly — no truncation or rounding', async () => {
      const admin = await superAdmin('super-plan-2@example.com');
      // 999,999.99 in a 2-decimal-place currency, expressed in minor
      // units — deliberately not a round number, to catch any silent
      // float-driven drift in the create -> Prisma -> response path.
      const preciseAmount = 99_999_999;

      const created = await request(server)
        .post('/api/v1/admin/plans')
        .set(auth(admin))
        .send({
          name: 'E2E Precise Amount Plan',
          slug: 'e2e-precise-amount-plan',
          tier: 'BUSINESS',
          priceAmount: preciseAmount,
          currency: 'NGN',
        })
        .expect(201);
      expect(created.body.priceAmount).toBe(preciseAmount);

      const fetched = await request(server)
        .get(`/api/v1/admin/plans/${created.body.id}`)
        .set(auth(admin))
        .expect(200);
      expect(fetched.body.priceAmount).toBe(preciseAmount);
    });

    it('rejects a priceAmount above MAX_MONEY_MINOR_UNITS instead of silently clamping it', async () => {
      const admin = await superAdmin('super-plan-3@example.com');

      await request(server)
        .post('/api/v1/admin/plans')
        .set(auth(admin))
        .send({
          name: 'E2E Oversized Amount Plan',
          slug: 'e2e-oversized-amount-plan',
          tier: 'BUSINESS',
          priceAmount: 1_000_000_000, // one above MAX_MONEY_MINOR_UNITS
        })
        .expect(400);
    });

    it('rejects a non-integer priceAmount rather than silently truncating a decimal', async () => {
      const admin = await superAdmin('super-plan-4@example.com');

      await request(server)
        .post('/api/v1/admin/plans')
        .set(auth(admin))
        .send({
          name: 'E2E Decimal Amount Plan',
          slug: 'e2e-decimal-amount-plan',
          tier: 'STARTER',
          priceAmount: 19.99, // must be sent as minor units (1999), never a float
        })
        .expect(400);
    });

    it('updating priceAmount persists the new value exactly, unrelated fields untouched', async () => {
      const admin = await superAdmin('super-plan-5@example.com');
      const created = await request(server)
        .post('/api/v1/admin/plans')
        .set(auth(admin))
        .send({
          name: 'E2E Update Amount Plan',
          slug: 'e2e-update-amount-plan',
          tier: 'PROFESSIONAL',
          priceAmount: 500,
          currency: 'NGN',
        })
        .expect(201);

      const updated = await request(server)
        .patch(`/api/v1/admin/plans/${created.body.id}`)
        .set(auth(admin))
        .send({ priceAmount: 1_999_999 })
        .expect(200);

      expect(updated.body.priceAmount).toBe(1_999_999);
      expect(updated.body.name).toBe('E2E Update Amount Plan');
    });
  });
});
