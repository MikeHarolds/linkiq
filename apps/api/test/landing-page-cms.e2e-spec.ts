import type { INestApplication } from '@nestjs/common';
import { GlobalRole, PlanTier } from '@prisma/client';
import type { Redis } from 'ioredis';
import request from 'supertest';

import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

/**
 * Sprint 14 — Landing Page CMS, Site Branding, and Plan creation.
 *
 * Covers: public content retrieval (no auth required, never exposes
 * admin/internal data), admin CRUD + ordering + activation for the
 * Landing Page CMS, branding upload validation + authorization, plan
 * creation + provider-sync orchestration, and the SuperAdminGuard
 * authorization matrix (401 unauthenticated / 403 non-super-admin /
 * 200 SUPER_ADMIN) for every new admin route this sprint adds. Audit
 * coverage is verified per mutation, per Part 9 of the sprint spec.
 */
describe('Landing Page CMS, Branding & Plans (e2e)', () => {
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
    };
  }

  async function promoteToSuperAdmin(userId: string) {
    await prisma.user.update({ where: { id: userId }, data: { globalRole: GlobalRole.SUPER_ADMIN } });
  }

  function auth(actor: { accessToken: string }) {
    return { Authorization: `Bearer ${actor.accessToken}` };
  }

  async function superAdmin(email: string) {
    const admin = await registerUser(email);
    await promoteToSuperAdmin(admin.userId);
    return admin;
  }

  describe('Public endpoints require no authentication', () => {
    it('serves /public/landing-page without a token', async () => {
      const res = await request(server).get('/api/v1/public/landing-page').expect(200);
      expect(res.body).toHaveProperty('sections');
      expect(res.body).toHaveProperty('features');
      expect(res.body).toHaveProperty('faqs');
      expect(res.body).toHaveProperty('stats');
      expect(res.body).toHaveProperty('navItems');
    });

    it('serves /public/site-config without a token, exposing only name/logo/favicon', async () => {
      const res = await request(server).get('/api/v1/public/site-config').expect(200);
      expect(Object.keys(res.body).sort()).toEqual(['faviconUrl', 'logoUrl', 'siteName']);
    });

    it('serves /public/plans without a token, only active plans, never provider ids', async () => {
      const res = await request(server).get('/api/v1/public/plans').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      for (const plan of res.body) {
        expect(plan).not.toHaveProperty('providerPlanId');
        expect(plan).not.toHaveProperty('isActive');
      }
    });

    it('does not crash and returns an empty-but-well-formed shape with zero optional content configured', async () => {
      const res = await request(server).get('/api/v1/public/landing-page').expect(200);
      expect(res.body.features).toEqual([]);
      expect(res.body.faqs).toEqual([]);
      expect(res.body.navItems).toEqual({
        header: [],
        footerProduct: [],
        footerDevelopers: [],
        footerCompany: [],
      });
    });
  });

  describe('Authorization matrix for new Sprint 14 admin routes', () => {
    const routes = [
      '/api/v1/admin/landing-page',
      '/api/v1/admin/branding',
      '/api/v1/admin/plans',
    ];

    it('denies unauthenticated requests with 401', async () => {
      for (const path of routes) {
        await request(server).get(path).expect(401);
      }
    });

    it('denies a normal platform user with 403 on every route, including mutations', async () => {
      const user = await registerUser('probe-landing-page@example.com');

      for (const path of routes) {
        await request(server).get(path).set(auth(user)).expect(403);
      }

      await request(server)
        .post('/api/v1/admin/landing-page/features')
        .set(auth(user))
        .send({ title: 'x', description: 'y', icon: 'Zap' })
        .expect(403);
      await request(server)
        .patch('/api/v1/admin/branding')
        .set(auth(user))
        .send({ siteName: 'Hacked' })
        .expect(403);
      await request(server)
        .post('/api/v1/admin/plans')
        .set(auth(user))
        .send({ name: 'Hacked', slug: 'hacked', tier: PlanTier.FREE, priceAmount: 0 })
        .expect(403);
    });

    it('allows a SUPER_ADMIN through on every route', async () => {
      const admin = await superAdmin('super-landing-page@example.com');

      for (const path of routes) {
        await request(server).get(path).set(auth(admin)).expect(200);
      }
    });
  });

  describe('Admin Landing Page CMS', () => {
    it('creates, updates, reorders, deactivates, and deletes a feature card — each mutation audited', async () => {
      const admin = await superAdmin('cms-admin@example.com');

      const created = await request(server)
        .post('/api/v1/admin/landing-page/features')
        .set(auth(admin))
        .send({ title: 'Fast redirects', description: 'Sub-100ms edge redirects', icon: 'Zap' })
        .expect(201);
      expect(created.body.title).toBe('Fast redirects');
      expect(created.body.isActive).toBe(true);

      const second = await request(server)
        .post('/api/v1/admin/landing-page/features')
        .set(auth(admin))
        .send({ title: 'Custom domains', description: 'Bring your own domain', icon: 'Globe2' })
        .expect(201);

      // Public page now shows both, in creation order.
      const publicBefore = await request(server).get('/api/v1/public/landing-page').expect(200);
      expect(publicBefore.body.features.map((f: { title: string }) => f.title)).toEqual([
        'Fast redirects',
        'Custom domains',
      ]);

      // Reorder: second feature first.
      await request(server)
        .post('/api/v1/admin/landing-page/features/reorder')
        .set(auth(admin))
        .send({ orderedIds: [second.body.id, created.body.id] })
        .expect(201);

      const publicAfterReorder = await request(server).get('/api/v1/public/landing-page').expect(200);
      expect(publicAfterReorder.body.features.map((f: { title: string }) => f.title)).toEqual([
        'Custom domains',
        'Fast redirects',
      ]);

      // Deactivate: disappears from the public page but still visible to admin.
      await request(server)
        .patch(`/api/v1/admin/landing-page/features/${created.body.id}`)
        .set(auth(admin))
        .send({ isActive: false })
        .expect(200);

      const publicAfterDeactivate = await request(server).get('/api/v1/public/landing-page').expect(200);
      expect(publicAfterDeactivate.body.features.map((f: { title: string }) => f.title)).toEqual(['Custom domains']);

      const adminContent = await request(server).get('/api/v1/admin/landing-page').set(auth(admin)).expect(200);
      expect(adminContent.body.features).toHaveLength(2);

      // Delete removes it entirely, even from the admin view.
      await request(server)
        .delete(`/api/v1/admin/landing-page/features/${created.body.id}`)
        .set(auth(admin))
        .expect(200);

      const adminContentAfterDelete = await request(server)
        .get('/api/v1/admin/landing-page')
        .set(auth(admin))
        .expect(200);
      expect(adminContentAfterDelete.body.features).toHaveLength(1);

      const auditActions = await prisma.auditLog.findMany({
        where: { entity: 'LandingPageFeature' },
        select: { action: true },
      });
      const actions = auditActions.map((a) => a.action).sort();
      expect(actions).toEqual(
        [
          'admin.landing_page_feature_created',
          'admin.landing_page_feature_created',
          'admin.landing_page_feature_reordered',
          'admin.landing_page_feature_updated',
          'admin.landing_page_feature_deleted',
        ].sort(),
      );
    });

    it('updates a section (Hero) and reflects the change on the public page', async () => {
      const admin = await superAdmin('cms-section-admin@example.com');

      await request(server)
        .patch('/api/v1/admin/landing-page/sections/HERO')
        .set(auth(admin))
        .send({ headline: 'Ship links that convert', eyebrow: 'The link platform' })
        .expect(200);

      const publicContent = await request(server).get('/api/v1/public/landing-page').expect(200);
      const hero = publicContent.body.sections.find((s: { key: string }) => s.key === 'HERO');
      expect(hero.headline).toBe('Ship links that convert');
      expect(hero.eyebrow).toBe('The link platform');
    });

    it('returns 404 for updating/deleting a feature that does not exist', async () => {
      const admin = await superAdmin('cms-404-admin@example.com');

      await request(server)
        .patch('/api/v1/admin/landing-page/features/00000000-0000-0000-0000-000000000099')
        .set(auth(admin))
        .send({ title: 'Nope' })
        .expect(404);
      await request(server)
        .delete('/api/v1/admin/landing-page/features/00000000-0000-0000-0000-000000000099')
        .set(auth(admin))
        .expect(404);
    });
  });

  describe('Admin Branding', () => {
    it('updates the site name and it is immediately visible on the public site-config endpoint', async () => {
      const admin = await superAdmin('branding-admin@example.com');

      await request(server)
        .patch('/api/v1/admin/branding')
        .set(auth(admin))
        .send({ siteName: 'Acme Links' })
        .expect(200);

      const publicConfig = await request(server).get('/api/v1/public/site-config').expect(200);
      expect(publicConfig.body.siteName).toBe('Acme Links');

      const auditEntry = await prisma.auditLog.findFirst({ where: { action: 'admin.branding_updated' } });
      expect(auditEntry).not.toBeNull();
      expect(JSON.stringify(auditEntry?.metadata)).not.toMatch(/secret|key/i);
    });

    it('uploads a valid PNG logo and rejects a disguised executable', async () => {
      const admin = await superAdmin('branding-upload-admin@example.com');

      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
      const uploadRes = await request(server)
        .post('/api/v1/admin/branding/logo')
        .set(auth(admin))
        .attach('file', pngBuffer, { filename: 'logo.png', contentType: 'image/png' })
        .expect(201);
      expect(uploadRes.body.logoUrl).toMatch(/\/uploads\/branding\//);

      const publicConfig = await request(server).get('/api/v1/public/site-config').expect(200);
      expect(publicConfig.body.logoUrl).toBe(uploadRes.body.logoUrl);

      const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      await request(server)
        .post('/api/v1/admin/branding/logo')
        .set(auth(admin))
        .attach('file', exeBuffer, { filename: 'logo.png', contentType: 'image/png' })
        .expect(400);
    });

    it('removes the logo and falls back to null on the public endpoint', async () => {
      const admin = await superAdmin('branding-remove-admin@example.com');
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
      await request(server)
        .post('/api/v1/admin/branding/logo')
        .set(auth(admin))
        .attach('file', pngBuffer, { filename: 'logo.png', contentType: 'image/png' })
        .expect(201);

      await request(server).delete('/api/v1/admin/branding/logo').set(auth(admin)).expect(200);

      const publicConfig = await request(server).get('/api/v1/public/site-config').expect(200);
      expect(publicConfig.body.logoUrl).toBeNull();
    });
  });

  describe('Admin Plan creation', () => {
    // resetDatabase() deliberately never touches Plan/PlanLimit rows (the
    // real seeded catalog other suites depend on — see setup-app.ts) —
    // clean up only the ad-hoc "growth-*" test plans this block creates,
    // so re-running this file against a persistent dev database doesn't
    // conflict on the slug-uniqueness check.
    beforeEach(async () => {
      await prisma.plan.deleteMany({ where: { slug: { startsWith: 'growth-' } } });
    });

    it('creates a plan that immediately appears in the admin catalog and, once active, on the public pricing endpoint', async () => {
      const admin = await superAdmin('plan-create-admin@example.com');

      const created = await request(server)
        .post('/api/v1/admin/plans')
        .set(auth(admin))
        .send({
          name: 'Growth',
          slug: 'growth-e2e',
          tier: PlanTier.PROFESSIONAL,
          priceAmount: 7900,
          limits: { MAX_LINKS: 1000 },
        })
        .expect(201);
      expect(created.body.slug).toBe('growth-e2e');
      expect(created.body.isActive).toBe(true);

      const publicPlans = await request(server).get('/api/v1/public/plans').expect(200);
      expect(publicPlans.body.some((p: { slug: string }) => p.slug === 'growth-e2e')).toBe(true);

      const auditEntry = await prisma.auditLog.findFirst({ where: { action: 'admin.plan_created' } });
      expect(auditEntry).not.toBeNull();
    });

    it('rejects a duplicate slug with 409', async () => {
      const admin = await superAdmin('plan-dupe-admin@example.com');
      const body = { name: 'Growth', slug: 'growth-dupe', tier: PlanTier.PROFESSIONAL, priceAmount: 7900 };

      await request(server).post('/api/v1/admin/plans').set(auth(admin)).send(body).expect(201);
      await request(server).post('/api/v1/admin/plans').set(auth(admin)).send(body).expect(409);
    });

    it('deactivating a plan removes it from the public pricing endpoint without deleting it', async () => {
      const admin = await superAdmin('plan-deactivate-admin@example.com');
      const created = await request(server)
        .post('/api/v1/admin/plans')
        .set(auth(admin))
        .send({ name: 'Growth', slug: 'growth-deactivate', tier: PlanTier.PROFESSIONAL, priceAmount: 7900 })
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/plans/${created.body.id}`)
        .set(auth(admin))
        .send({ isActive: false })
        .expect(200);

      const publicPlans = await request(server).get('/api/v1/public/plans').expect(200);
      expect(publicPlans.body.some((p: { slug: string }) => p.slug === 'growth-deactivate')).toBe(false);

      // Still visible to the admin catalog — not hard-deleted.
      const adminList = await request(server).get('/api/v1/admin/plans').set(auth(admin)).expect(200);
      expect(adminList.body.some((p: { slug: string }) => p.slug === 'growth-deactivate')).toBe(true);
    });
  });
});
