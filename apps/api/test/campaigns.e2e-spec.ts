import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import request from 'supertest';

import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

describe('Campaigns (e2e)', () => {
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

  function headers(actor: { accessToken: string }, workspaceId: string) {
    return {
      Authorization: `Bearer ${actor.accessToken}`,
      'X-Workspace-Id': workspaceId,
    };
  }

  async function createCampaign(
    owner: { accessToken: string; workspaceId: string },
    body: Record<string, unknown>,
  ) {
    const res = await request(server)
      .post('/api/v1/campaigns')
      .set(headers(owner, owner.workspaceId))
      .send(body);
    return res.body;
  }

  describe('POST /campaigns', () => {
    it('rejects unauthenticated requests', async () => {
      await request(server)
        .post('/api/v1/campaigns')
        .send({ name: 'Test' })
        .expect(401);
    });

    it('creates a campaign with defaults', async () => {
      const owner = await registerUser('camp-create1@example.com');

      const res = await request(server)
        .post('/api/v1/campaigns')
        .set(headers(owner, owner.workspaceId))
        .send({ name: '2026 Summer Campaign' })
        .expect(201);

      expect(res.body.name).toBe('2026 Summer Campaign');
      expect(res.body.status).toBe('DRAFT');
    });

    it('rejects a duplicate name within the same workspace', async () => {
      const owner = await registerUser('camp-create2@example.com');
      await createCampaign(owner, { name: 'Dup Test' });

      await request(server)
        .post('/api/v1/campaigns')
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Dup Test' })
        .expect(409);
    });

    it('allows the same campaign name in a DIFFERENT workspace', async () => {
      const ownerA = await registerUser('camp-create3a@example.com');
      const ownerB = await registerUser('camp-create3b@example.com');
      await createCampaign(ownerA, { name: 'Shared Name' });

      await request(server)
        .post('/api/v1/campaigns')
        .set(headers(ownerB, ownerB.workspaceId))
        .send({ name: 'Shared Name' })
        .expect(201);
    });

    it('allows reusing a name after the original campaign is deleted', async () => {
      const owner = await registerUser('camp-create4@example.com');
      const first = await createCampaign(owner, { name: 'Reusable Name' });
      await request(server)
        .delete(`/api/v1/campaigns/${first.id}`)
        .set(headers(owner, owner.workspaceId))
        .expect(204);

      await request(server)
        .post('/api/v1/campaigns')
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Reusable Name' })
        .expect(201);
    });

    it('rejects an invalid date range', async () => {
      const owner = await registerUser('camp-create5@example.com');
      await request(server)
        .post('/api/v1/campaigns')
        .set(headers(owner, owner.workspaceId))
        .send({
          name: 'Bad Dates',
          startDate: '2026-08-01T00:00:00.000Z',
          endDate: '2026-07-01T00:00:00.000Z',
        })
        .expect(400);
    });

    it('writes a campaign.created audit log entry', async () => {
      const owner = await registerUser('camp-audit1@example.com');
      const campaign = await createCampaign(owner, {
        name: 'Audited Campaign',
      });

      const logs = await prisma.auditLog.findMany({
        where: { action: 'campaign.created', entityId: campaign.id },
      });
      expect(logs).toHaveLength(1);
    });
  });

  describe('Workspace isolation & RBAC', () => {
    async function inviteAs(
      owner: { accessToken: string; workspaceId: string },
      email: string,
      role: string,
    ) {
      const account = await registerUser(email);
      await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/members/invite`)
        .set(headers(owner, owner.workspaceId))
        .send({ email, role });
      return account;
    }

    it('returns 404 (not 403) for a campaign in another workspace, even with a valid ID', async () => {
      const owner = await registerUser('camp-iso-owner1@example.com');
      const outsiderMember = await inviteAs(
        owner,
        'camp-iso-member1@example.com',
        'ADMIN',
      );
      const campaign = await createCampaign(owner, { name: 'Isolated' });
      void outsiderMember;

      const trueOutsider = await registerUser('camp-iso-outsider1@example.com');
      await request(server)
        .get(`/api/v1/campaigns/${campaign.id}`)
        .set({
          Authorization: `Bearer ${trueOutsider.accessToken}`,
          'X-Workspace-Id': owner.workspaceId,
        })
        .expect(403); // not a member of that workspace at all
    });

    it('VIEWER can read and view analytics but not create campaigns', async () => {
      const owner = await registerUser('camp-rbac-owner1@example.com');
      const campaign = await createCampaign(owner, { name: 'Viewer Test' });
      const viewer = await inviteAs(
        owner,
        'camp-rbac-viewer1@example.com',
        'VIEWER',
      );
      const viewerHeaders = headers(viewer, owner.workspaceId);

      await request(server)
        .get(`/api/v1/campaigns/${campaign.id}`)
        .set(viewerHeaders)
        .expect(200);
      await request(server)
        .get(`/api/v1/campaigns/${campaign.id}/analytics?range=today`)
        .set(viewerHeaders)
        .expect(200);
      await request(server)
        .post('/api/v1/campaigns')
        .set(viewerHeaders)
        .send({ name: 'Should fail' })
        .expect(403);
    });

    it('MEMBER can create, update, and delete campaigns', async () => {
      const owner = await registerUser('camp-rbac-owner2@example.com');
      const member = await inviteAs(
        owner,
        'camp-rbac-member2@example.com',
        'MEMBER',
      );
      const memberHeaders = headers(member, owner.workspaceId);

      const created = await request(server)
        .post('/api/v1/campaigns')
        .set(memberHeaders)
        .send({ name: 'Member Campaign' })
        .expect(201);

      await request(server)
        .patch(`/api/v1/campaigns/${created.body.id}`)
        .set(memberHeaders)
        .send({ description: 'Updated' })
        .expect(200);

      await request(server)
        .delete(`/api/v1/campaigns/${created.body.id}`)
        .set(memberHeaders)
        .expect(204);
    });

    it('ADMIN has full campaign management', async () => {
      const owner = await registerUser('camp-rbac-owner3@example.com');
      const admin = await inviteAs(
        owner,
        'camp-rbac-admin3@example.com',
        'ADMIN',
      );
      const adminHeaders = headers(admin, owner.workspaceId);

      const created = await request(server)
        .post('/api/v1/campaigns')
        .set(adminHeaders)
        .send({ name: 'Admin Campaign' })
        .expect(201);

      await request(server)
        .post(`/api/v1/campaigns/${created.body.id}/activate`)
        .set(adminHeaders)
        .expect(200);
    });
  });

  describe('Lifecycle', () => {
    it('DRAFT -> ACTIVE -> PAUSED -> ACTIVE -> ARCHIVED', async () => {
      const owner = await registerUser('camp-lifecycle1@example.com');
      const campaign = await createCampaign(owner, { name: 'Lifecycle Test' });

      const active = await request(server)
        .post(`/api/v1/campaigns/${campaign.id}/activate`)
        .set(headers(owner, owner.workspaceId))
        .expect(200);
      expect(active.body.status).toBe('ACTIVE');

      const paused = await request(server)
        .post(`/api/v1/campaigns/${campaign.id}/pause`)
        .set(headers(owner, owner.workspaceId))
        .expect(200);
      expect(paused.body.status).toBe('PAUSED');

      const reactivated = await request(server)
        .post(`/api/v1/campaigns/${campaign.id}/activate`)
        .set(headers(owner, owner.workspaceId))
        .expect(200);
      expect(reactivated.body.status).toBe('ACTIVE');

      const archived = await request(server)
        .post(`/api/v1/campaigns/${campaign.id}/archive`)
        .set(headers(owner, owner.workspaceId))
        .expect(200);
      expect(archived.body.status).toBe('ARCHIVED');
    });

    it('rejects an invalid transition (ARCHIVED cannot go back to ACTIVE)', async () => {
      const owner = await registerUser('camp-lifecycle2@example.com');
      const campaign = await createCampaign(owner, {
        name: 'Invalid Transition Test',
      });
      await request(server)
        .post(`/api/v1/campaigns/${campaign.id}/archive`)
        .set(headers(owner, owner.workspaceId));

      await request(server)
        .post(`/api/v1/campaigns/${campaign.id}/activate`)
        .set(headers(owner, owner.workspaceId))
        .expect(400);
    });
  });

  describe('Link integration', () => {
    it('a link created with a campaignId inherits the campaign UTM defaults', async () => {
      const owner = await registerUser('camp-link1@example.com');
      const campaign = await createCampaign(owner, {
        name: 'UTM Inherit Test',
        utmSource: 'newsletter',
        utmMedium: 'email',
      });

      const link = await request(server)
        .post('/api/v1/links')
        .set(headers(owner, owner.workspaceId))
        .send({
          destinationUrl: 'https://example.com/product?id=123',
          slug: 'utm-inherit-link',
          campaignId: campaign.id,
        })
        .expect(201);

      expect(link.body.utmSource).toBe('newsletter');
      expect(link.body.utmMedium).toBe('email');
      expect(link.body.campaignId).toBe(campaign.id);
    });

    it('an explicit UTM override wins over the campaign default', async () => {
      const owner = await registerUser('camp-link2@example.com');
      const campaign = await createCampaign(owner, {
        name: 'UTM Override Test',
        utmSource: 'newsletter',
      });

      const link = await request(server)
        .post('/api/v1/links')
        .set(headers(owner, owner.workspaceId))
        .send({
          destinationUrl: 'https://example.com/',
          slug: 'utm-override-link',
          campaignId: campaign.id,
          utmSource: 'facebook',
        })
        .expect(201);

      expect(link.body.utmSource).toBe('facebook');
    });

    it('a redirect for a campaign-linked link applies UTM params (preserving existing query params)', async () => {
      const owner = await registerUser('camp-link3@example.com');
      const campaign = await createCampaign(owner, {
        name: 'Redirect UTM Test',
        utmSource: 'facebook',
        utmMedium: 'social',
      });
      await request(server)
        .post('/api/v1/links')
        .set(headers(owner, owner.workspaceId))
        .send({
          destinationUrl: 'https://example.com/product?id=123',
          slug: 'redirect-utm-link',
          campaignId: campaign.id,
        });

      const res = await request(server).get('/redirect-utm-link').redirects(0);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(
        'https://example.com/product?id=123&utm_source=facebook&utm_medium=social',
      );
    });

    it('deleting a campaign does not delete or disable its links', async () => {
      const owner = await registerUser('camp-link4@example.com');
      const campaign = await createCampaign(owner, {
        name: 'Delete Safety Test',
      });
      await request(server)
        .post('/api/v1/links')
        .set(headers(owner, owner.workspaceId))
        .send({
          destinationUrl: 'https://example.com/x',
          slug: 'delete-safety-link',
          campaignId: campaign.id,
        });

      await request(server)
        .delete(`/api/v1/campaigns/${campaign.id}`)
        .set(headers(owner, owner.workspaceId))
        .expect(204);

      const redirectRes = await request(server)
        .get('/delete-safety-link')
        .redirects(0);
      expect(redirectRes.status).toBe(302);

      const linkRes = await request(server)
        .get('/api/v1/links')
        .set(headers(owner, owner.workspaceId))
        .expect(200);
      expect(linkRes.body.items).toHaveLength(1);
    });

    it('a link with no campaign works exactly as before (no campaignId required)', async () => {
      const owner = await registerUser('camp-link5@example.com');

      const link = await request(server)
        .post('/api/v1/links')
        .set(headers(owner, owner.workspaceId))
        .send({
          destinationUrl: 'https://example.com/plain',
          slug: 'plain-link',
        })
        .expect(201);

      expect(link.body.campaignId).toBeNull();

      const res = await request(server).get('/plain-link').redirects(0);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://example.com/plain');
    });

    it('rejects a campaignId for a campaign that does not exist', async () => {
      const owner = await registerUser('camp-link6@example.com');

      await request(server)
        .post('/api/v1/links')
        .set(headers(owner, owner.workspaceId))
        .send({
          destinationUrl: 'https://example.com/',
          campaignId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(404);
    });

    it('GET /campaigns/:id/links lists links assigned to the campaign, with their QR codes', async () => {
      const owner = await registerUser('camp-link7@example.com');
      const campaign = await createCampaign(owner, { name: 'Links List Test' });
      const link = await request(server)
        .post('/api/v1/links')
        .set(headers(owner, owner.workspaceId))
        .send({
          destinationUrl: 'https://example.com/x',
          slug: 'links-list-link',
          campaignId: campaign.id,
        });

      await request(server)
        .post(`/api/v1/links/${link.body.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Campaign QR' });

      const res = await request(server)
        .get(`/api/v1/campaigns/${campaign.id}/links`)
        .set(headers(owner, owner.workspaceId))
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].shortCode).toBe('links-list-link');
      expect(res.body[0].qrCodes).toHaveLength(1);
      expect(res.body[0].qrCodes[0].name).toBe('Campaign QR');
    });
  });

  describe('Campaign analytics', () => {
    async function waitForClickEvents(
      linkId: string,
      expectedCount: number,
      timeoutMs = 5000,
    ) {
      const deadline = Date.now() + timeoutMs;
      let count = 0;
      while (Date.now() < deadline) {
        count = await prisma.clickEvent.count({ where: { linkId } });
        if (count >= expectedCount) return count;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return count;
    }

    it('aggregates real click events across every link in the campaign', async () => {
      const owner = await registerUser('camp-analytics1@example.com');
      const campaign = await createCampaign(owner, {
        name: 'Analytics Aggregation Test',
        utmSource: 'facebook',
      });
      const link1 = await request(server)
        .post('/api/v1/links')
        .set(headers(owner, owner.workspaceId))
        .send({
          destinationUrl: 'https://example.com/a',
          slug: 'agg-link-1',
          campaignId: campaign.id,
        });
      const link2 = await request(server)
        .post('/api/v1/links')
        .set(headers(owner, owner.workspaceId))
        .send({
          destinationUrl: 'https://example.com/b',
          slug: 'agg-link-2',
          campaignId: campaign.id,
        });

      const HUMAN_UA =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0';
      await request(server)
        .get('/agg-link-1')
        .set('User-Agent', HUMAN_UA)
        .redirects(0);
      await request(server)
        .get('/agg-link-1')
        .set('User-Agent', HUMAN_UA)
        .redirects(0);
      await request(server)
        .get('/agg-link-2')
        .set('User-Agent', HUMAN_UA)
        .redirects(0);

      await waitForClickEvents(link1.body.id, 2);
      await waitForClickEvents(link2.body.id, 1);

      const analytics = await request(server)
        .get(`/api/v1/campaigns/${campaign.id}/analytics?range=today`)
        .set(headers(owner, owner.workspaceId))
        .expect(200);

      expect(analytics.body.overview.totalClicks).toBe(3);
      expect(analytics.body.topLinks).toHaveLength(2);
      expect(analytics.body.topSources).toEqual([
        { value: 'facebook', clicks: 3 },
      ]);
    });

    it('does not include clicks from links OUTSIDE the campaign', async () => {
      const owner = await registerUser('camp-analytics2@example.com');
      const campaign = await createCampaign(owner, { name: 'Isolation Test' });
      const inCampaign = await request(server)
        .post('/api/v1/links')
        .set(headers(owner, owner.workspaceId))
        .send({
          destinationUrl: 'https://example.com/a',
          slug: 'in-campaign-link',
          campaignId: campaign.id,
        });
      await request(server)
        .post('/api/v1/links')
        .set(headers(owner, owner.workspaceId))
        .send({
          destinationUrl: 'https://example.com/b',
          slug: 'outside-campaign-link',
        });

      await request(server).get('/in-campaign-link').redirects(0);
      await request(server).get('/outside-campaign-link').redirects(0);
      await waitForClickEvents(inCampaign.body.id, 1);

      const analytics = await request(server)
        .get(`/api/v1/campaigns/${campaign.id}/analytics?range=today`)
        .set(headers(owner, owner.workspaceId))
        .expect(200);

      expect(analytics.body.overview.totalClicks).toBe(1);
    });

    it('respects workspace isolation for analytics', async () => {
      const owner = await registerUser('camp-analytics3@example.com');
      const outsider = await registerUser('camp-analytics3b@example.com');
      const campaign = await createCampaign(owner, {
        name: 'Analytics Isolation Test',
      });

      await request(server)
        .get(`/api/v1/campaigns/${campaign.id}/analytics?range=today`)
        .set({
          Authorization: `Bearer ${outsider.accessToken}`,
          'X-Workspace-Id': owner.workspaceId,
        })
        .expect(403);
    });

    it('404s for analytics on a nonexistent campaign', async () => {
      const owner = await registerUser('camp-analytics4@example.com');
      await request(server)
        .get(
          '/api/v1/campaigns/00000000-0000-0000-0000-000000000000/analytics?range=today',
        )
        .set(headers(owner, owner.workspaceId))
        .expect(404);
    });
  });

  describe('CRUD / listing', () => {
    it('lists campaigns with pagination and link counts', async () => {
      const owner = await registerUser('camp-list1@example.com');
      for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await createCampaign(owner, { name: `List Campaign ${i}` });
      }

      const res = await request(server)
        .get('/api/v1/campaigns?page=1&pageSize=2')
        .set(headers(owner, owner.workspaceId))
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.pagination.totalItems).toBe(3);
      expect(res.body.items[0]).toHaveProperty('linkCount');
    });

    it('filters by status', async () => {
      const owner = await registerUser('camp-list2@example.com');
      const active = await createCampaign(owner, { name: 'Active Campaign' });
      await createCampaign(owner, { name: 'Draft Campaign' });
      await request(server)
        .post(`/api/v1/campaigns/${active.id}/activate`)
        .set(headers(owner, owner.workspaceId));

      const res = await request(server)
        .get('/api/v1/campaigns?status=ACTIVE')
        .set(headers(owner, owner.workspaceId))
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe('Active Campaign');
    });

    it('searches by name', async () => {
      const owner = await registerUser('camp-list3@example.com');
      await createCampaign(owner, { name: 'Findable Campaign' });
      await createCampaign(owner, { name: 'Other One' });

      const res = await request(server)
        .get('/api/v1/campaigns?search=findable')
        .set(headers(owner, owner.workspaceId))
        .expect(200);

      expect(res.body.items).toHaveLength(1);
    });

    it('deletes a campaign — it disappears from listing and direct access', async () => {
      const owner = await registerUser('camp-list4@example.com');
      const campaign = await createCampaign(owner, { name: 'To Delete' });

      await request(server)
        .delete(`/api/v1/campaigns/${campaign.id}`)
        .set(headers(owner, owner.workspaceId))
        .expect(204);

      await request(server)
        .get(`/api/v1/campaigns/${campaign.id}`)
        .set(headers(owner, owner.workspaceId))
        .expect(404);
    });
  });
});
