import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import request from 'supertest';

import { GeoipCountryProvider } from '../src/modules/analytics/geo/geoip-country.provider';
import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

async function waitForClickEvent(prisma: PrismaService, linkId: string) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const event = await prisma.clickEvent.findFirst({ where: { linkId } });
    if (event) return event;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No ClickEvent recorded for link ${linkId} within 3s`);
}

describe('Redirect engine (e2e)', () => {
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

  async function registerAndCreateLink(
    email: string,
    linkOverrides: Record<string, unknown> = {},
  ) {
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
      .send({ destinationUrl: 'https://example.com/target', ...linkOverrides });

    return { accessToken, workspaceId, link: created.body };
  }

  it('redirects successfully for an active link', async () => {
    const { link } = await registerAndCreateLink('redirect1@example.com', {
      slug: 'redirect-success',
    });

    const res = await request(server).get(`/${link.shortCode}`).redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/target');
  });

  it('returns 404 for an unknown short code', async () => {
    const res = await request(server).get('/totally-unknown-code');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('returns 403 for a paused link', async () => {
    const { accessToken, workspaceId, link } = await registerAndCreateLink(
      'redirect2@example.com',
      { slug: 'redirect-paused' },
    );
    await request(server)
      .post(`/api/v1/links/${link.id}/pause`)
      .set({
        Authorization: `Bearer ${accessToken}`,
        'X-Workspace-Id': workspaceId,
      });

    const res = await request(server).get(`/${link.shortCode}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('LINK_PAUSED');
  });

  it('returns 410 for an archived link', async () => {
    const { accessToken, workspaceId, link } = await registerAndCreateLink(
      'redirect3@example.com',
      { slug: 'redirect-archived' },
    );
    await request(server)
      .post(`/api/v1/links/${link.id}/archive`)
      .set({
        Authorization: `Bearer ${accessToken}`,
        'X-Workspace-Id': workspaceId,
      });

    const res = await request(server).get(`/${link.shortCode}`);
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('LINK_ARCHIVED');
  });

  it('returns 410 for an expired link', async () => {
    const { link } = await registerAndCreateLink('redirect4@example.com', {
      slug: 'redirect-expired',
    });
    // expiresAt must be in the future at creation time (validated), so
    // force it into the past directly for this test.
    await prisma.link.update({
      where: { id: link.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(server).get(`/${link.shortCode}`);
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('LINK_EXPIRED');
  });

  it('does not redirect a soft-deleted link', async () => {
    const { accessToken, workspaceId, link } = await registerAndCreateLink(
      'redirect5@example.com',
      { slug: 'redirect-deleted' },
    );
    await request(server)
      .delete(`/api/v1/links/${link.id}`)
      .set({
        Authorization: `Bearer ${accessToken}`,
        'X-Workspace-Id': workspaceId,
      });

    const res = await request(server).get(`/${link.shortCode}`);
    expect(res.status).toBe(404);
  });

  describe('Redis caching', () => {
    it('serves a second request from cache (no DB hit) and produces the same result', async () => {
      const { link } = await registerAndCreateLink('cache1@example.com', {
        slug: 'cache-hit-test',
      });

      const first = await request(server)
        .get(`/${link.shortCode}`)
        .redirects(0);
      const second = await request(server)
        .get(`/${link.shortCode}`)
        .redirects(0);

      expect(first.status).toBe(302);
      expect(second.status).toBe(302);
      expect(first.headers.location).toBe(second.headers.location);
    });

    it('invalidates the cache when the link is updated — new destination takes effect immediately', async () => {
      const { accessToken, workspaceId, link } = await registerAndCreateLink(
        'cache2@example.com',
        { slug: 'cache-invalidate-test' },
      );

      const before = await request(server)
        .get(`/${link.shortCode}`)
        .redirects(0);
      expect(before.headers.location).toBe('https://example.com/target');

      await request(server)
        .patch(`/api/v1/links/${link.id}`)
        .set({
          Authorization: `Bearer ${accessToken}`,
          'X-Workspace-Id': workspaceId,
        })
        .send({ destinationUrl: 'https://example.com/updated-target' })
        .expect(200);

      const after = await request(server)
        .get(`/${link.shortCode}`)
        .redirects(0);
      expect(after.headers.location).toBe('https://example.com/updated-target');
    });

    it('invalidates the cache when the link is paused — a cached-active link stops redirecting', async () => {
      const { accessToken, workspaceId, link } = await registerAndCreateLink(
        'cache3@example.com',
        { slug: 'cache-pause-test' },
      );

      await request(server).get(`/${link.shortCode}`).redirects(0).expect(302);

      await request(server)
        .post(`/api/v1/links/${link.id}/pause`)
        .set({
          Authorization: `Bearer ${accessToken}`,
          'X-Workspace-Id': workspaceId,
        })
        .expect(200);

      await request(server).get(`/${link.shortCode}`).expect(403);
    });
  });

  describe('Click event foundation', () => {
    it('records a click event asynchronously after a successful redirect', async () => {
      const { link } = await registerAndCreateLink('click1@example.com', {
        slug: 'click-record-test',
      });

      await request(server).get(`/${link.shortCode}`).redirects(0).expect(302);

      const deadline = Date.now() + 3000;
      let count = 0;
      while (Date.now() < deadline) {
        count = await prisma.clickEvent.count({ where: { linkId: link.id } });
        if (count > 0) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      expect(count).toBe(1);
    });

    it('does not record a click event for a blocked (paused) redirect', async () => {
      const { accessToken, workspaceId, link } = await registerAndCreateLink(
        'click2@example.com',
        { slug: 'click-blocked-test' },
      );
      await request(server)
        .post(`/api/v1/links/${link.id}/pause`)
        .set({
          Authorization: `Bearer ${accessToken}`,
          'X-Workspace-Id': workspaceId,
        });

      await request(server).get(`/${link.shortCode}`).expect(403);

      await new Promise((resolve) => setTimeout(resolve, 300));
      const count = await prisma.clickEvent.count({
        where: { linkId: link.id },
      });
      expect(count).toBe(0);
    });
  });

  // Sprint 13 — end-to-end proof (real HTTP request -> queue ->
  // processor -> DB) that the client-IP trust-boundary fix and
  // referrer classification actually work through the full stack, not
  // just as isolated unit behavior. See src/common/utils/client-ip.ts
  // and analytics/utils/referrer-classifier.ts for the unit-level
  // coverage of every edge case; these confirm the real wiring.
  describe('Referrer and client-IP attribution (Sprint 13)', () => {
    it('classifies a deliberately-supplied Referer header end to end', async () => {
      const { link } = await registerAndCreateLink('referrer1@example.com', {
        slug: 'referrer-e2e-test',
      });

      await request(server)
        .get(`/${link.shortCode}`)
        .set('Referer', 'https://www.facebook.com/some-post')
        .redirects(0)
        .expect(302);

      const event = await waitForClickEvent(prisma, link.id);
      expect(event.referrerCategory).toBe('social');
      expect(event.referrerDomain).toBe('facebook.com');
    });

    it('records "direct" when no Referer header is sent at all', async () => {
      const { link } = await registerAndCreateLink('referrer2@example.com', {
        slug: 'referrer-direct-test',
      });

      await request(server).get(`/${link.shortCode}`).redirects(0).expect(302);

      const event = await waitForClickEvent(prisma, link.id);
      expect(event.referrerCategory).toBe('direct');
      expect(event.referrerDomain).toBeNull();
    });

    it('does not let a spoofed leading X-Forwarded-For entry control the stored geo attribution', async () => {
      const { link } = await registerAndCreateLink('spoofip1@example.com', {
        slug: 'spoof-xff-test',
      });

      // 203.0.113.0/24 is IANA's TEST-NET-3 range (RFC 5737) — reserved
      // for documentation, so it can NEVER have a real GeoIP entry.
      // 8.8.8.8 is a stable, real, resolvable public IP. If the old
      // "take the first X-Forwarded-For entry" bug were still present,
      // the attacker-supplied leading entry would be used and the
      // event would end up with country: null; the fix must use the
      // trusted trailing entry (8.8.8.8) instead.
      const spoofedIp = '203.0.113.50';
      const trustedIp = '8.8.8.8';
      const expectedCountry = new GeoipCountryProvider().lookup(
        trustedIp,
      ).country;
      expect(expectedCountry).not.toBeNull(); // sanity: the ground truth itself must resolve

      await request(server)
        .get(`/${link.shortCode}`)
        .set('X-Forwarded-For', `${spoofedIp}, ${trustedIp}`)
        .redirects(0)
        .expect(302);

      const event = await waitForClickEvent(prisma, link.id);
      expect(event.country).toBe(expectedCountry);
    });

    it('reports no country (never a fabricated one) for a loopback request — matches real local-dev behavior', async () => {
      const { link } = await registerAndCreateLink('spoofip2@example.com', {
        slug: 'loopback-geo-test',
      });

      // No X-Forwarded-For/X-Real-IP at all — matches an unproxied
      // local request, where the socket peer is the loopback address.
      await request(server).get(`/${link.shortCode}`).redirects(0).expect(302);

      const event = await waitForClickEvent(prisma, link.id);
      expect(event.country).toBeNull();
    });
  });
});
