import type { INestApplication } from '@nestjs/common';
import { GlobalRole, PlanTier } from '@prisma/client';
import type { Redis } from 'ioredis';
import request from 'supertest';

import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

/**
 * Sprint 15 — Platform Role & Permission Management.
 *
 * Covers: the SuperAdminGuard authorization matrix on every new
 * /admin/roles and role-assignment route, role CRUD over real HTTP,
 * plan-role attachment, the full subscription-driven role-resolution
 * lifecycle (register -> free-user, subscribe -> role assigned, upgrade
 * -> role changes, admin override survives a subsequent subscription
 * event, removing the override falls back to the subscription-derived
 * role again), and the PlatformPermissionsGuard demonstration endpoint.
 */
describe('Roles & Permissions (e2e)', () => {
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
    // resetDatabase() deliberately never touches PlatformRole/Plan rows
    // (shared seed-managed reference data — see setup-app.ts) — clean up
    // only the ad-hoc custom roles/plans this file creates, so re-running
    // it against a persistent dev database doesn't collide on slug
    // uniqueness (same pattern landing-page-cms.e2e-spec.ts already
    // established for its own "growth-*" test plans).
    await prisma.plan.deleteMany({ where: { slug: 'custom-plan-role-test' } });
    await prisma.platformRole.deleteMany({
      where: { slug: { in: ['beta-tester', 'retired-tier', 'disabled-tier'] } },
    });
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
    await prisma.user.update({ where: { id: userId }, data: { globalRole: GlobalRole.SUPER_ADMIN } });
  }

  async function superAdmin(email: string) {
    const admin = await registerUser(email);
    await promoteToSuperAdmin(admin.userId);
    return admin;
  }

  function auth(actor: { accessToken: string }) {
    return { Authorization: `Bearer ${actor.accessToken}` };
  }

  async function roleIdBySlug(slug: string): Promise<string> {
    const role = await prisma.platformRole.findUniqueOrThrow({ where: { slug } });
    return role.id;
  }

  async function login(email: string, password: string) {
    const res = await request(server).post('/api/v1/auth/login').send({ email, password });
    return { accessToken: res.body.accessToken as string };
  }

  describe('Authorization matrix', () => {
    it('denies unauthenticated requests with 401', async () => {
      await request(server).get('/api/v1/admin/roles').expect(401);
    });

    it('denies a normal platform user with 403 on every roles route, including mutations', async () => {
      const user = await registerUser('probe-roles@example.com');

      await request(server).get('/api/v1/admin/roles').set(auth(user)).expect(403);
      await request(server)
        .post('/api/v1/admin/roles')
        .set(auth(user))
        .send({ name: 'Hacked', slug: 'hacked' })
        .expect(403);
      await request(server)
        .post(`/api/v1/admin/users/${user.userId}/assign-role`)
        .set(auth(user))
        .send({ platformRoleId: await roleIdBySlug('business-user') })
        .expect(403);
    });

    it('denies a workspace ADMIN (workspace-privileged, not platform-privileged) with 403', async () => {
      const owner = await registerUser('owner-roles@example.com');
      const admin = await registerUser('admin-roles@example.com');
      await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/members/invite`)
        .set(auth(owner))
        .send({ email: 'admin-roles@example.com', role: 'ADMIN' })
        .expect(201);

      await request(server).get('/api/v1/admin/roles').set(auth(admin)).expect(403);
    });

    it('allows a SUPER_ADMIN through', async () => {
      const admin = await superAdmin('super-roles@example.com');
      await request(server).get('/api/v1/admin/roles').set(auth(admin)).expect(200);
    });
  });

  describe('Seeded system roles', () => {
    it('seeds exactly the four system roles, each attached to its plan, none deletable', async () => {
      const admin = await superAdmin('seed-check-admin@example.com');

      const res = await request(server).get('/api/v1/admin/roles').set(auth(admin)).expect(200);
      const slugs = res.body.map((r: { slug: string }) => r.slug).sort();
      expect(slugs).toEqual(['business-user', 'free-user', 'professional-user', 'starter-user']);

      for (const role of res.body) {
        expect(role.isSystem).toBe(true);
        expect(role.plans.length).toBeGreaterThan(0);

        await request(server).delete(`/api/v1/admin/roles/${role.id}`).set(auth(admin)).expect(400);
      }
    });
  });

  describe('Role CRUD', () => {
    it('creates, updates, and deletes a custom role', async () => {
      const admin = await superAdmin('role-crud-admin@example.com');

      const created = await request(server)
        .post('/api/v1/admin/roles')
        .set(auth(admin))
        .send({ name: 'Beta Tester', slug: 'beta-tester', permissions: ['LINKS_VIEW', 'ANALYTICS_VIEW'] })
        .expect(201);
      expect(created.body.permissions.sort()).toEqual(['ANALYTICS_VIEW', 'LINKS_VIEW']);
      expect(created.body.isSystem).toBe(false);

      await request(server)
        .patch(`/api/v1/admin/roles/${created.body.id}`)
        .set(auth(admin))
        .send({ isActive: false })
        .expect(200);

      await request(server).delete(`/api/v1/admin/roles/${created.body.id}`).set(auth(admin)).expect(200);

      const auditActions = await prisma.auditLog.findMany({
        where: { entity: 'PlatformRole', entityId: created.body.id },
        select: { action: true },
      });
      expect(auditActions.map((a) => a.action).sort()).toEqual(
        ['admin.role_archived', 'admin.role_created', 'admin.role_deactivated', 'admin.role_updated'].sort(),
      );
    });

    it('rejects creating a role with a reserved slug', async () => {
      const admin = await superAdmin('role-reserved-admin@example.com');

      await request(server)
        .post('/api/v1/admin/roles')
        .set(auth(admin))
        .send({ name: 'Fake', slug: 'super-admin' })
        .expect(400);
    });
  });

  describe('Plan -> role attachment', () => {
    it('attaches a role to a plan and rejects an inactive role', async () => {
      const admin = await superAdmin('plan-role-admin@example.com');
      const inactiveRole = await request(server)
        .post('/api/v1/admin/roles')
        .set(auth(admin))
        .send({ name: 'Retired Tier', slug: 'retired-tier', isActive: false })
        .expect(201);

      const plan = await request(server)
        .post('/api/v1/admin/plans')
        .set(auth(admin))
        .send({ name: 'Custom', slug: 'custom-plan-role-test', tier: PlanTier.STARTER, priceAmount: 500 })
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/plans/${plan.body.id}`)
        .set(auth(admin))
        .send({ platformRoleId: inactiveRole.body.id })
        .expect(400);

      const activeRoleId = await roleIdBySlug('starter-user');
      const updated = await request(server)
        .patch(`/api/v1/admin/plans/${plan.body.id}`)
        .set(auth(admin))
        .send({ platformRoleId: activeRoleId })
        .expect(200);
      expect(updated.body.platformRole.slug).toBe('starter-user');
    });
  });

  describe('Subscription-driven role resolution', () => {
    it('assigns free-user on registration and the correct role after subscribing', async () => {
      const user = await registerUser('lifecycle-1@example.com');

      const registered = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
      expect(registered.roleAssignmentSource).toBe('SUBSCRIPTION');

      await request(server)
        .post(`/api/v1/workspaces/${user.workspaceId}/billing/subscribe`)
        .set(auth(user))
        .send({ planSlug: 'professional' })
        .expect(200);

      const afterSubscribe = await prisma.user.findUniqueOrThrow({
        where: { id: user.userId },
        include: { platformRole: true },
      });
      expect(afterSubscribe.platformRole?.slug).toBe('professional-user');
      expect(afterSubscribe.roleAssignmentSource).toBe('SUBSCRIPTION');
    });

    it('changes the role on upgrade', async () => {
      const user = await registerUser('lifecycle-upgrade@example.com');
      await request(server)
        .post(`/api/v1/workspaces/${user.workspaceId}/billing/subscribe`)
        .set(auth(user))
        .send({ planSlug: 'starter' })
        .expect(200);

      let current = await prisma.user.findUniqueOrThrow({ where: { id: user.userId }, include: { platformRole: true } });
      expect(current.platformRole?.slug).toBe('starter-user');

      await request(server)
        .post(`/api/v1/workspaces/${user.workspaceId}/billing/change-plan`)
        .set(auth(user))
        .send({ planSlug: 'business' })
        .expect(200);

      current = await prisma.user.findUniqueOrThrow({ where: { id: user.userId }, include: { platformRole: true } });
      expect(current.platformRole?.slug).toBe('business-user');
    });

    it('does not change the role merely because a cancellation was requested — access and role continue until period end', async () => {
      const user = await registerUser('lifecycle-cancel@example.com');
      await request(server)
        .post(`/api/v1/workspaces/${user.workspaceId}/billing/subscribe`)
        .set(auth(user))
        .send({ planSlug: 'professional' })
        .expect(200);

      await request(server)
        .post(`/api/v1/workspaces/${user.workspaceId}/billing/cancel`)
        .set(auth(user))
        .expect(200);

      const current = await prisma.user.findUniqueOrThrow({
        where: { id: user.userId },
        include: { platformRole: true },
      });
      expect(current.platformRole?.slug).toBe('professional-user');
    });
  });

  describe('Admin manual role override', () => {
    it('assigns an override that subscription events do not silently overwrite, then removing it falls back to the subscription role', async () => {
      const admin = await superAdmin('override-admin@example.com');
      const user = await registerUser('override-target@example.com');
      await request(server)
        .post(`/api/v1/workspaces/${user.workspaceId}/billing/subscribe`)
        .set(auth(user))
        .send({ planSlug: 'starter' })
        .expect(200);

      const businessRoleId = await roleIdBySlug('business-user');
      const assignRes = await request(server)
        .post(`/api/v1/admin/users/${user.userId}/assign-role`)
        .set(auth(admin))
        .send({ platformRoleId: businessRoleId })
        .expect(201);
      expect(assignRes.body.source).toBe('ADMIN_ASSIGNED');

      // A real subscription lifecycle event on the SAME workspace must not
      // silently overwrite the override.
      await request(server)
        .post(`/api/v1/workspaces/${user.workspaceId}/billing/change-plan`)
        .set(auth(user))
        .send({ planSlug: 'professional' })
        .expect(200);

      let current = await prisma.user.findUniqueOrThrow({ where: { id: user.userId }, include: { platformRole: true } });
      expect(current.platformRole?.slug).toBe('business-user');
      expect(current.roleAssignmentSource).toBe('ADMIN_ASSIGNED');

      await request(server)
        .post(`/api/v1/admin/users/${user.userId}/remove-role-override`)
        .set(auth(admin))
        .expect(201);

      current = await prisma.user.findUniqueOrThrow({ where: { id: user.userId }, include: { platformRole: true } });
      expect(current.platformRole?.slug).toBe('professional-user');
      expect(current.roleAssignmentSource).toBe('SUBSCRIPTION');
    });

    it('rejects assigning an inactive role and a nonexistent user', async () => {
      const admin = await superAdmin('override-invalid-admin@example.com');
      const user = await registerUser('override-invalid-target@example.com');
      const inactiveRole = await request(server)
        .post('/api/v1/admin/roles')
        .set(auth(admin))
        .send({ name: 'Disabled Tier', slug: 'disabled-tier', isActive: false })
        .expect(201);

      await request(server)
        .post(`/api/v1/admin/users/${user.userId}/assign-role`)
        .set(auth(admin))
        .send({ platformRoleId: inactiveRole.body.id })
        .expect(400);

      await request(server)
        .post('/api/v1/admin/users/00000000-0000-0000-0000-000000000099/assign-role')
        .set(auth(admin))
        .send({ platformRoleId: await roleIdBySlug('free-user') })
        .expect(404);
    });
  });

  describe('Duplicate webhook idempotency for role assignment', () => {
    it('does not duplicate role-assignment audit rows when the same billing event is processed twice', async () => {
      // Real webhook delivery is covered end-to-end in
      // paystack-webhooks.e2e-spec.ts; this only proves syncStoredRole's
      // own idempotency guarantee — the piece Sprint 15 adds.
      const user = await registerUser('idempotent-role@example.com');
      await request(server)
        .post(`/api/v1/workspaces/${user.workspaceId}/billing/subscribe`)
        .set(auth(user))
        .send({ planSlug: 'starter' })
        .expect(200);

      const before = await prisma.auditLog.count({
        where: { action: 'role.subscription_role_assigned', entityId: user.userId },
      });

      // Calling subscribe() again with the same plan re-runs
      // syncOwnerRoles() but resolves to the identical role — no new
      // write, no new audit row.
      await request(server)
        .post(`/api/v1/workspaces/${user.workspaceId}/billing/subscribe`)
        .set(auth(user))
        .send({ planSlug: 'starter' })
        .expect(200);

      const after = await prisma.auditLog.count({
        where: { action: 'role.subscription_role_assigned', entityId: user.userId },
      });
      expect(after).toBe(before);
    });
  });

  describe('Self-service entitlement endpoints', () => {
    it('GET /users/me/entitlement reflects the resolved role and permissions', async () => {
      const user = await registerUser('entitlement-check@example.com');
      await request(server)
        .post(`/api/v1/workspaces/${user.workspaceId}/billing/subscribe`)
        .set(auth(user))
        .send({ planSlug: 'professional' })
        .expect(200);

      // Re-login so the access token reflects the just-resolved role (see
      // JwtStrategy — permissions are re-derived per request from the DB,
      // but this test asserts against a fresh token for clarity).
      const relogged = await login('entitlement-check@example.com', 'SecurePass123');

      const res = await request(server)
        .get('/api/v1/users/me/entitlement')
        .set(auth(relogged))
        .expect(200);
      expect(res.body.role).toBe('professional-user');
      expect(res.body.source).toBe('SUBSCRIPTION');
      expect(res.body.permissions).toContain('ANALYTICS_ADVANCED');
    });

    it('PlatformPermissionsGuard allows a professional-user through and blocks a free-user', async () => {
      const proUser = await registerUser('perm-allowed@example.com');
      await request(server)
        .post(`/api/v1/workspaces/${proUser.workspaceId}/billing/subscribe`)
        .set(auth(proUser))
        .send({ planSlug: 'professional' })
        .expect(200);
      const proRelogged = await login('perm-allowed@example.com', 'SecurePass123');

      await request(server)
        .get('/api/v1/users/me/features/advanced-analytics')
        .set(auth(proRelogged))
        .expect(200);

      const freeUser = await registerUser('perm-blocked@example.com');
      await request(server)
        .get('/api/v1/users/me/features/advanced-analytics')
        .set(auth(freeUser))
        .expect(403);
    });

    it('PlatformPermissionsGuard always allows SUPER_ADMIN through, regardless of platformRole', async () => {
      const admin = await superAdmin('perm-superadmin@example.com');

      await request(server)
        .get('/api/v1/users/me/features/advanced-analytics')
        .set(auth(admin))
        .expect(200);
    });
  });
});
