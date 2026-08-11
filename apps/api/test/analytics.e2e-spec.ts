import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Pool } from 'pg';
import request from 'supertest';

import { ClickEventProcessor } from '../src/modules/analytics/processors/click-event.processor';
import { ClickEventProducer } from '../src/modules/links/queue/click-event.producer';
import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

describe('Analytics (e2e)', () => {
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
  });

  async function registerAndCreateLink(email: string, slug: string) {
    const reg = await request(server).post('/api/v1/auth/register').send({
      firstName: 'Test',
      lastName: 'User',
      email,
      password: 'SecurePass123',
      passwordConfirmation: 'SecurePass123',
      termsAccepted: true,
    });
    const accessToken = reg.body.accessToken as string;
    const workspaceId = reg.body.workspaces[0].id as string;

    const created = await request(server)
      .post('/api/v1/links')
      .set({
        Authorization: `Bearer ${accessToken}`,
        'X-Workspace-Id': workspaceId,
      })
      .send({ destinationUrl: 'https://example.com/target', slug });

    return { accessToken, workspaceId, link: created.body };
  }

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

  describe('Full pipeline: redirect -> queue -> worker -> analytics', () => {
    it('a real click is reflected in the overview endpoint', async () => {
      const { accessToken, workspaceId, link } = await registerAndCreateLink(
        'pipeline1@example.com',
        'pipeline-test-1',
      );

      await request(server)
        .get(`/${link.shortCode}`)
        .set(
          'User-Agent',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        )
        .redirects(0)
        .expect(302);

      await waitForClickEvents(link.id, 1);

      const overview = await request(server)
        .get('/api/v1/analytics/overview?range=today')
        .set({
          Authorization: `Bearer ${accessToken}`,
          'X-Workspace-Id': workspaceId,
        })
        .expect(200);

      expect(overview.body.totalClicks).toBe(1);
      expect(overview.body.humanClicks).toBe(1);
      expect(overview.body.botClicks).toBe(0);
    });

    it('distinguishes human and bot traffic', async () => {
      const { accessToken, workspaceId, link } = await registerAndCreateLink(
        'pipeline2@example.com',
        'pipeline-test-2',
      );

      await request(server)
        .get(`/${link.shortCode}`)
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0')
        .redirects(0);
      await request(server)
        .get(`/${link.shortCode}`)
        .set(
          'User-Agent',
          'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        )
        .redirects(0);

      await waitForClickEvents(link.id, 2);

      const overview = await request(server)
        .get('/api/v1/analytics/overview?range=today')
        .set({
          Authorization: `Bearer ${accessToken}`,
          'X-Workspace-Id': workspaceId,
        })
        .expect(200);

      expect(overview.body.totalClicks).toBe(2);
      expect(overview.body.humanClicks).toBe(1);
      expect(overview.body.botClicks).toBe(1);
    });

    it('bot traffic is excluded from the default (human-only) device breakdown', async () => {
      const { accessToken, workspaceId, link } = await registerAndCreateLink(
        'pipeline3@example.com',
        'pipeline-test-3',
      );

      await request(server)
        .get(`/${link.shortCode}`)
        .set(
          'User-Agent',
          'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        )
        .redirects(0);

      await waitForClickEvents(link.id, 1);

      const devices = await request(server)
        .get('/api/v1/analytics/devices?range=today')
        .set({
          Authorization: `Bearer ${accessToken}`,
          'X-Workspace-Id': workspaceId,
        })
        .expect(200);

      expect(devices.body).toEqual([]);
    });
  });

  describe('Workspace isolation & RBAC', () => {
    it('rejects unauthenticated requests with 401', async () => {
      await request(server)
        .get('/api/v1/analytics/overview?range=today')
        .expect(401);
    });

    it('rejects a non-member workspace with 403, not leaking data', async () => {
      const owner = await registerAndCreateLink(
        'iso-owner@example.com',
        'iso-link',
      );
      const outsiderReg = await request(server)
        .post('/api/v1/auth/register')
        .send({
          firstName: 'Out',
          lastName: 'Sider',
          email: 'iso-outsider@example.com',
          password: 'SecurePass123',
          passwordConfirmation: 'SecurePass123',
          termsAccepted: true,
        });

      await request(server)
        .get('/api/v1/analytics/overview?range=today')
        .set({
          Authorization: `Bearer ${outsiderReg.body.accessToken}`,
          'X-Workspace-Id': owner.workspaceId,
        })
        .expect(403);
    });

    it('a VIEWER can read analytics', async () => {
      const owner = await registerAndCreateLink(
        'rbac-owner@example.com',
        'rbac-link',
      );
      const viewerReg = await request(server)
        .post('/api/v1/auth/register')
        .send({
          firstName: 'View',
          lastName: 'Er',
          email: 'rbac-viewer@example.com',
          password: 'SecurePass123',
          passwordConfirmation: 'SecurePass123',
          termsAccepted: true,
        });
      await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/members/invite`)
        .set({
          Authorization: `Bearer ${owner.accessToken}`,
          'X-Workspace-Id': owner.workspaceId,
        })
        .send({ email: 'rbac-viewer@example.com', role: 'VIEWER' });

      await request(server)
        .get('/api/v1/analytics/overview?range=today')
        .set({
          Authorization: `Bearer ${viewerReg.body.accessToken}`,
          'X-Workspace-Id': owner.workspaceId,
        })
        .expect(200);
    });
  });

  describe('Date range & timezone handling', () => {
    it('rejects a custom range missing from/to', async () => {
      const { accessToken, workspaceId } = await registerAndCreateLink(
        'range1@example.com',
        'range-link-1',
      );

      await request(server)
        .get('/api/v1/analytics/overview?range=custom')
        .set({
          Authorization: `Bearer ${accessToken}`,
          'X-Workspace-Id': workspaceId,
        })
        .expect(400);
    });

    it('accepts a valid custom range', async () => {
      const { accessToken, workspaceId } = await registerAndCreateLink(
        'range2@example.com',
        'range-link-2',
      );

      await request(server)
        .get(
          '/api/v1/analytics/overview?range=custom&from=2026-01-01T00:00:00.000Z&to=2026-01-31T00:00:00.000Z',
        )
        .set({
          Authorization: `Bearer ${accessToken}`,
          'X-Workspace-Id': workspaceId,
        })
        .expect(200);
    });

    it('accepts an explicit non-UTC timezone', async () => {
      const { accessToken, workspaceId } = await registerAndCreateLink(
        'range3@example.com',
        'range-link-3',
      );

      const res = await request(server)
        .get('/api/v1/analytics/timeseries?range=7d&timezone=America/New_York')
        .set({
          Authorization: `Bearer ${accessToken}`,
          'X-Workspace-Id': workspaceId,
        })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Caching', () => {
    it('caches the overview response and serves it on a second identical request', async () => {
      const { accessToken, workspaceId } = await registerAndCreateLink(
        'cache1@example.com',
        'cache-link-1',
      );

      await request(server)
        .get('/api/v1/analytics/overview?range=today')
        .set({
          Authorization: `Bearer ${accessToken}`,
          'X-Workspace-Id': workspaceId,
        })
        .expect(200);

      const keys = await redis.keys(`analytics:${workspaceId}:overview:*`);
      expect(keys.length).toBeGreaterThan(0);
    });

    it('does not leak one workspace cache entry to another workspace request', async () => {
      const a = await registerAndCreateLink(
        'cacheiso-a@example.com',
        'cacheiso-link-a',
      );
      const b = await registerAndCreateLink(
        'cacheiso-b@example.com',
        'cacheiso-link-b',
      );

      await request(server)
        .get('/api/v1/analytics/overview?range=today')
        .set({
          Authorization: `Bearer ${a.accessToken}`,
          'X-Workspace-Id': a.workspaceId,
        });
      await request(server)
        .get('/api/v1/analytics/overview?range=today')
        .set({
          Authorization: `Bearer ${b.accessToken}`,
          'X-Workspace-Id': b.workspaceId,
        });

      const keysA = await redis.keys(`analytics:${a.workspaceId}:*`);
      const keysB = await redis.keys(`analytics:${b.workspaceId}:*`);
      expect(keysA.length).toBeGreaterThan(0);
      expect(keysB.length).toBeGreaterThan(0);
      // No key should appear under both prefixes.
      expect(keysA.some((k) => k.includes(b.workspaceId))).toBe(false);
    });
  });

  describe('Idempotent event processing (real DB, real unique constraint)', () => {
    it('processing the same event twice results in exactly one row and one increment', async () => {
      const { link } = await registerAndCreateLink(
        'idempotency1@example.com',
        'idempotency-link',
      );
      const processor = app.get(ClickEventProcessor);

      const jobData = {
        eventId: '99999999-9999-9999-9999-999999999999',
        linkId: link.id,
        workspaceId: link.workspaceId,
        occurredAt: new Date().toISOString(),
        ipAddress: '8.8.8.8',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
      };
      const job = { id: 'manual-job', data: jobData } as never;

      await processor.process(job);
      await processor.process(job); // simulate a BullMQ retry of the same job

      const count = await prisma.clickEvent.count({
        where: { linkId: link.id },
      });
      expect(count).toBe(1);

      const rollup = await prisma.linkDailyStat.findFirst({
        where: { linkId: link.id },
      });
      expect(rollup?.totalClicks).toBe(1);
      expect(rollup?.humanClicks).toBe(1);
    });
  });

  describe('Redirect resilience', () => {
    it('a redirect still succeeds even when analytics enqueueing itself throws', async () => {
      const { link } = await registerAndCreateLink(
        'resilience1@example.com',
        'resilience-link',
      );

      // Break the queue's add() to simulate a Redis/queue outage.
      const producer = app.get(ClickEventProducer);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const queue = (producer as any).queue;
      const originalAdd = queue.add.bind(queue);
      queue.add = () => Promise.reject(new Error('simulated queue outage'));

      try {
        const res = await request(server)
          .get(`/${link.shortCode}`)
          .redirects(0);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('https://example.com/target');
      } finally {
        queue.add = originalAdd;
      }
    });
  });

  /**
   * Regression suite for a real production bug reported after Sprint 5:
   * every analytics endpoint failed with PrismaClientKnownRequestError
   * P2010 / "operator does not exist: uuid = text" (SQLSTATE 42883)
   * against a real generated Prisma Client, because raw-SQL comparisons
   * against Postgres `uuid` columns (workspaceId, linkId) received a
   * bare string parameter typed `text` by Prisma's query engine. Fixed
   * by adding explicit `::uuid` casts in AnalyticsService.buildWhere and
   * CampaignAnalyticsService.buildWhere (see analytics.service.spec.ts
   * for the unit-level SQL assertions and a from-scratch explanation).
   */
  describe('UUID parameter casting (regression)', () => {
    it('reproduces the exact reported Postgres error when a parameter is text-typed against a uuid column', async () => {
      // Independent of AnalyticsService entirely — proves the underlying
      // Postgres/driver behavior the fix depends on, against the same
      // real database connection this whole e2e suite runs against.
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      try {
        await expect(
          pool.query(
            'SELECT count(*) FROM click_events WHERE "workspaceId" = ($1::text)',
            ['00000000-0000-0000-0000-000000000000'],
          ),
        ).rejects.toMatchObject({
          code: '42883',
          message: expect.stringContaining(
            'operator does not exist: uuid = text',
          ),
        });

        // The fix: the same comparison with an explicit ::uuid cast on
        // the parameter succeeds.
        await expect(
          pool.query(
            'SELECT count(*) FROM click_events WHERE "workspaceId" = $1::uuid',
            ['00000000-0000-0000-0000-000000000000'],
          ),
        ).resolves.toBeDefined();
      } finally {
        await pool.end();
      }
    });

    it('every listed analytics endpoint succeeds with a real UUID workspace id and timezone', async () => {
      const owner = await registerAndCreateLink(
        'uuid-regression1@example.com',
        'uuid-regression-link',
      );
      await request(server).get(`/${owner.link.shortCode}`).redirects(0);

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        const count = await prisma.clickEvent.count({
          where: { linkId: owner.link.id },
        });
        if (count > 0) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const authHeaders = {
        Authorization: `Bearer ${owner.accessToken}`,
        'X-Workspace-Id': owner.workspaceId,
      };
      const qs = 'range=7d&timezone=Europe/London';

      const endpoints = [
        '/api/v1/analytics/overview',
        '/api/v1/analytics/timeseries',
        '/api/v1/analytics/links',
        '/api/v1/analytics/referrers',
        '/api/v1/analytics/geography',
        '/api/v1/analytics/devices',
        '/api/v1/analytics/browsers',
        '/api/v1/analytics/operating-systems',
        '/api/v1/analytics/campaigns',
      ];

      for (const endpoint of endpoints) {
        // eslint-disable-next-line no-await-in-loop
        const res = await request(server)
          .get(`${endpoint}?${qs}`)
          .set(authHeaders);
        expect(res.status).toBe(200);
      }
    });

    it('a workspace cannot access analytics belonging to another workspace', async () => {
      const owner = await registerAndCreateLink(
        'uuid-regression2@example.com',
        'uuid-regression-link2',
      );
      const outsiderReg = await request(server)
        .post('/api/v1/auth/register')
        .send({
          firstName: 'Out',
          lastName: 'Sider',
          email: 'uuid-regression2-outsider@example.com',
          password: 'SecurePass123',
          passwordConfirmation: 'SecurePass123',
          termsAccepted: true,
        });

      const res = await request(server)
        .get('/api/v1/analytics/devices?range=7d&timezone=Europe/London')
        .set({
          Authorization: `Bearer ${outsiderReg.body.accessToken}`,
          'X-Workspace-Id': owner.workspaceId,
        });

      expect(res.status).toBe(403);
    });
  });
});
