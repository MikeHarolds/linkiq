import type { INestApplication } from '@nestjs/common';
import type { ApiKeyPermission } from '@prisma/client';
import type { Redis } from 'ioredis';
import request from 'supertest';

import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

describe('API Keys & Developer API (e2e)', () => {
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

  function apiKeyHeaders(rawKey: string) {
    return { Authorization: `Bearer ${rawKey}` };
  }

  function createApiKeyRequestAs(
    actor: { accessToken: string },
    workspaceId: string,
    body: { name: string; permissions: ApiKeyPermission[]; expiresAt?: string },
  ) {
    return request(server)
      .post(`/api/v1/workspaces/${workspaceId}/api-keys`)
      .set(headers(actor))
      .send(body);
  }

  function createApiKeyRequest(
    owner: { accessToken: string; workspaceId: string },
    body: { name: string; permissions: ApiKeyPermission[]; expiresAt?: string },
  ) {
    return createApiKeyRequestAs(owner, owner.workspaceId, body);
  }

  async function createApiKey(
    owner: { accessToken: string; workspaceId: string },
    permissions: ApiKeyPermission[],
    expiresAt?: string,
  ) {
    const res = await createApiKeyRequest(owner, {
      name: 'Test Key',
      permissions,
      expiresAt,
    });
    return { rawKey: res.body.key as string, id: res.body.id as string };
  }

  describe('creating an API key', () => {
    it('creates a key and returns the full secret exactly once, in the exact lk_live_ format', async () => {
      const owner = await registerUser('create1@example.com');

      const res = await createApiKeyRequest(owner, {
        name: 'Production Website',
        permissions: ['LINKS_READ', 'LINKS_WRITE'],
      });

      expect(res.status).toBe(201);
      expect(res.body.key).toMatch(/^lk_live_/);
      expect(res.body.keyPrefix).toBe(
        res.body.key.slice(0, res.body.keyPrefix.length),
      );
      expect(res.body.name).toBe('Production Website');
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.permissions).toEqual(['LINKS_READ', 'LINKS_WRITE']);
    });

    it('never returns the secret again from list or get responses', async () => {
      const owner = await registerUser('create2@example.com');
      const { id } = await createApiKey(owner, ['LINKS_READ']);

      const listRes = await request(server)
        .get(`/api/v1/workspaces/${owner.workspaceId}/api-keys`)
        .set(headers(owner));
      const getRes = await request(server)
        .get(`/api/v1/workspaces/${owner.workspaceId}/api-keys/${id}`)
        .set(headers(owner));

      expect(listRes.body[0]).not.toHaveProperty('key');
      expect(listRes.body[0]).not.toHaveProperty('keyHash');
      expect(getRes.body).not.toHaveProperty('key');
      expect(getRes.body).not.toHaveProperty('keyHash');
    });

    it('rejects creation with no permissions selected (400)', async () => {
      const owner = await registerUser('create3@example.com');

      const res = await createApiKeyRequest(owner, {
        name: 'No Permissions',
        permissions: [],
      });

      expect(res.status).toBe(400);
    });

    it('a MEMBER cannot create an API key (403)', async () => {
      const owner = await registerUser('create4a@example.com');
      const member = await registerUser('create4b@example.com');
      await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/members/invite`)
        .set(headers(owner))
        .send({ email: 'create4b@example.com', role: 'MEMBER' })
        .expect(201);

      const res = await createApiKeyRequestAs(member, owner.workspaceId, {
        name: 'Should fail',
        permissions: ['LINKS_READ'],
      });

      expect(res.status).toBe(403);
    });

    it('a VIEWER can list API keys but not create one', async () => {
      const owner = await registerUser('create5a@example.com');
      const viewer = await registerUser('create5b@example.com');
      await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/members/invite`)
        .set(headers(owner))
        .send({ email: 'create5b@example.com', role: 'VIEWER' })
        .expect(201);
      await createApiKey(owner, ['LINKS_READ']);

      await request(server)
        .get(`/api/v1/workspaces/${owner.workspaceId}/api-keys`)
        .set(headers(viewer))
        .expect(200);
      const createRes = await createApiKeyRequestAs(viewer, owner.workspaceId, {
        name: 'Should fail',
        permissions: ['LINKS_READ'],
      });
      expect(createRes.status).toBe(403);
    });
  });

  describe('authenticating with an API key', () => {
    it('a valid key with the right permission authenticates successfully', async () => {
      const owner = await registerUser('auth1@example.com');
      const { rawKey } = await createApiKey(owner, ['LINKS_READ']);

      const res = await request(server)
        .get('/api/v1/links')
        .set(apiKeyHeaders(rawKey));

      expect(res.status).toBe(200);
    });

    it('an unrecognized key is rejected with 401 INVALID_API_KEY', async () => {
      const res = await request(server)
        .get('/api/v1/links')
        .set(apiKeyHeaders('lk_live_doesnotexistatall00000000000000'));

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_API_KEY');
    });

    it('a request with no Authorization header at all is rejected with 401', async () => {
      const res = await request(server).get('/api/v1/links');
      expect(res.status).toBe(401);
    });

    it('a revoked key is rejected immediately — no caching delay', async () => {
      const owner = await registerUser('auth2@example.com');
      const { rawKey, id } = await createApiKey(owner, ['LINKS_READ']);
      await request(server)
        .get('/api/v1/links')
        .set(apiKeyHeaders(rawKey))
        .expect(200);

      await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/api-keys/${id}/revoke`)
        .set(headers(owner))
        .expect(200);

      const res = await request(server)
        .get('/api/v1/links')
        .set(apiKeyHeaders(rawKey));
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('API_KEY_REVOKED');
    });

    it('an expired key is rejected with 401 API_KEY_EXPIRED', async () => {
      const owner = await registerUser('auth3@example.com');
      const { rawKey } = await createApiKey(
        owner,
        ['LINKS_READ'],
        new Date(Date.now() - 60_000).toISOString(),
      );

      const res = await request(server)
        .get('/api/v1/links')
        .set(apiKeyHeaders(rawKey));

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('API_KEY_EXPIRED');
    });

    it('a key with a future expiration still works', async () => {
      const owner = await registerUser('auth4@example.com');
      const { rawKey } = await createApiKey(
        owner,
        ['LINKS_READ'],
        new Date(Date.now() + 86_400_000).toISOString(),
      );

      await request(server)
        .get('/api/v1/links')
        .set(apiKeyHeaders(rawKey))
        .expect(200);
    });
  });

  describe('permissions', () => {
    it('a read-only key can list links but cannot create one (403 API_PERMISSION_DENIED)', async () => {
      const owner = await registerUser('perm1@example.com');
      const { rawKey } = await createApiKey(owner, ['LINKS_READ']);

      await request(server)
        .get('/api/v1/links')
        .set(apiKeyHeaders(rawKey))
        .expect(200);
      const res = await request(server)
        .post('/api/v1/links')
        .set(apiKeyHeaders(rawKey))
        .send({ destinationUrl: 'https://example.com/x', slug: 'perm1-link' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('API_PERMISSION_DENIED');
    });

    it('a key with LINKS_WRITE can create a link', async () => {
      const owner = await registerUser('perm2@example.com');
      const { rawKey } = await createApiKey(owner, [
        'LINKS_WRITE',
        'LINKS_READ',
      ]);

      const res = await request(server)
        .post('/api/v1/links')
        .set(apiKeyHeaders(rawKey))
        .send({ destinationUrl: 'https://example.com/x', slug: 'perm2-link' });

      expect(res.status).toBe(201);
    });

    it('a key without ANALYTICS_READ cannot call analytics endpoints', async () => {
      const owner = await registerUser('perm3@example.com');
      const { rawKey } = await createApiKey(owner, ['LINKS_READ']);

      const res = await request(server)
        .get('/api/v1/analytics/overview')
        .set(apiKeyHeaders(rawKey));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('API_PERMISSION_DENIED');
    });

    it('a key with ANALYTICS_READ can call analytics endpoints', async () => {
      const owner = await registerUser('perm4@example.com');
      const { rawKey } = await createApiKey(owner, ['ANALYTICS_READ']);

      await request(server)
        .get('/api/v1/analytics/overview')
        .set(apiKeyHeaders(rawKey))
        .expect(200);
    });

    it('a key without DOMAINS_WRITE cannot create a custom domain', async () => {
      const owner = await registerUser('perm5@example.com');
      const { rawKey } = await createApiKey(owner, ['DOMAINS_READ']);

      const res = await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/domains`)
        .set(apiKeyHeaders(rawKey))
        .send({ domain: 'api-perm-test.acme.com' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('API_PERMISSION_DENIED');
    });
  });

  describe('workspace isolation', () => {
    it("a key from workspace A cannot access workspace B's domains, even though the key is otherwise valid", async () => {
      const ownerA = await registerUser('iso1a@example.com');
      const ownerB = await registerUser('iso1b@example.com');
      const { rawKey } = await createApiKey(ownerA, ['DOMAINS_READ']);

      const res = await request(server)
        .get(`/api/v1/workspaces/${ownerB.workspaceId}/domains`)
        .set(apiKeyHeaders(rawKey));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('WORKSPACE_ACCESS_DENIED');
    });

    it('an X-Workspace-Id header cannot override the workspace encoded in the key', async () => {
      const ownerA = await registerUser('iso2a@example.com');
      const ownerB = await registerUser('iso2b@example.com');
      const { rawKey } = await createApiKey(ownerA, [
        'LINKS_WRITE',
        'LINKS_READ',
      ]);

      const res = await request(server)
        .post('/api/v1/links')
        .set({ ...apiKeyHeaders(rawKey), 'X-Workspace-Id': ownerB.workspaceId })
        .send({ destinationUrl: 'https://example.com/x', slug: 'iso2-link' });

      expect(res.status).toBe(201);
      expect(res.body.workspaceId).toBe(ownerA.workspaceId);

      const foundInA = await prisma.link.findFirst({
        where: { workspaceId: ownerA.workspaceId, shortCode: 'iso2-link' },
      });
      const foundInB = await prisma.link.findFirst({
        where: { workspaceId: ownerB.workspaceId, shortCode: 'iso2-link' },
      });
      expect(foundInA).not.toBeNull();
      expect(foundInB).toBeNull();
    });
  });

  describe('developer API surface reuses the existing services', () => {
    it('creates, retrieves, updates, and deletes a link through the API key', async () => {
      const owner = await registerUser('surface1@example.com');
      const { rawKey } = await createApiKey(owner, [
        'LINKS_READ',
        'LINKS_WRITE',
      ]);
      const h = apiKeyHeaders(rawKey);

      const created = await request(server)
        .post('/api/v1/links')
        .set(h)
        .send({
          destinationUrl: 'https://example.com/original',
          slug: 'surface1-link',
        });
      expect(created.status).toBe(201);

      const fetched = await request(server)
        .get(`/api/v1/links/${created.body.id}`)
        .set(h);
      expect(fetched.status).toBe(200);
      expect(fetched.body.destinationUrl).toBe('https://example.com/original');

      const updated = await request(server)
        .patch(`/api/v1/links/${created.body.id}`)
        .set(h)
        .send({ destinationUrl: 'https://example.com/updated' });
      expect(updated.status).toBe(200);
      expect(updated.body.destinationUrl).toBe('https://example.com/updated');

      await request(server)
        .delete(`/api/v1/links/${created.body.id}`)
        .set(h)
        .expect(204);
    });

    it('creates and retrieves a campaign through the API key', async () => {
      const owner = await registerUser('surface2@example.com');
      const { rawKey } = await createApiKey(owner, [
        'CAMPAIGNS_READ',
        'CAMPAIGNS_WRITE',
      ]);
      const h = apiKeyHeaders(rawKey);

      const created = await request(server)
        .post('/api/v1/campaigns')
        .set(h)
        .send({ name: 'API Campaign' });
      expect(created.status).toBe(201);

      const fetched = await request(server)
        .get(`/api/v1/campaigns/${created.body.id}`)
        .set(h);
      expect(fetched.status).toBe(200);
      expect(fetched.body.name).toBe('API Campaign');
    });

    it('creates and retrieves a QR code through the API key', async () => {
      const owner = await registerUser('surface3@example.com');
      const { rawKey } = await createApiKey(owner, [
        'LINKS_WRITE',
        'QRCODES_READ',
        'QRCODES_WRITE',
      ]);
      const h = apiKeyHeaders(rawKey);

      const link = await request(server)
        .post('/api/v1/links')
        .set(h)
        .send({
          destinationUrl: 'https://example.com/qr',
          slug: 'surface3-link',
        });
      expect(link.status).toBe(201);

      const qr = await request(server)
        .post(`/api/v1/links/${link.body.id}/qrcodes`)
        .set(h)
        .send({ name: 'API QR' });
      expect(qr.status).toBe(201);

      const fetched = await request(server)
        .get(`/api/v1/qrcodes/${qr.body.id}`)
        .set(h);
      expect(fetched.status).toBe(200);
    });

    it('retrieves custom domains through the API key', async () => {
      const owner = await registerUser('surface4@example.com');
      const { rawKey } = await createApiKey(owner, ['DOMAINS_READ']);

      const res = await request(server)
        .get(`/api/v1/workspaces/${owner.workspaceId}/domains`)
        .set(apiKeyHeaders(rawKey));

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });

    it('retrieves workspace info through the API key with WORKSPACE_READ', async () => {
      const owner = await registerUser('surface5@example.com');
      const { rawKey } = await createApiKey(owner, ['WORKSPACE_READ']);

      const res = await request(server)
        .get(`/api/v1/workspaces/${owner.workspaceId}`)
        .set(apiKeyHeaders(rawKey));

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(owner.workspaceId);
    });
  });

  describe('API plan limits', () => {
    it('blocks further API requests once MONTHLY_API_REQUESTS is exhausted, without disabling links/redirects', async () => {
      const owner = await registerUser('planlimit1@example.com');
      const { rawKey } = await createApiKey(owner, [
        'LINKS_READ',
        'LINKS_WRITE',
      ]);

      const link = await request(server)
        .post('/api/v1/links')
        .set(apiKeyHeaders(rawKey))
        .send({
          destinationUrl: 'https://example.com/still-works',
          slug: 'planlimit1-link',
        });
      expect(link.status).toBe(201);

      // FREE plan's MONTHLY_API_REQUESTS limit is 1000 — pre-seed 1000
      // usage events directly rather than firing 1000 real requests.
      await prisma.apiUsageEvent.createMany({
        data: Array.from({ length: 1000 }, () => ({
          workspaceId: owner.workspaceId,
          apiKeyId: null,
          endpoint: '/api/v1/links',
          method: 'GET',
          statusCode: 200,
          createdAt: new Date(),
        })),
      });

      const res = await request(server)
        .get('/api/v1/links')
        .set(apiKeyHeaders(rawKey));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('API_PLAN_LIMIT_REACHED');

      // The existing link is completely unaffected — still resolvable via
      // the public redirect, which never depends on the API-key layer.
      const redirectRes = await request(server)
        .get('/planlimit1-link')
        .redirects(0);
      expect(redirectRes.status).toBe(302);
    });

    it('records a usage event asynchronously for a successful API request', async () => {
      const owner = await registerUser('planlimit2@example.com');
      const { rawKey } = await createApiKey(owner, ['LINKS_READ']);

      await request(server)
        .get('/api/v1/links')
        .set(apiKeyHeaders(rawKey))
        .expect(200);

      const deadline = Date.now() + 3000;
      let count = 0;
      while (Date.now() < deadline) {
        count = await prisma.apiUsageEvent.count({
          where: { workspaceId: owner.workspaceId },
        });
        if (count > 0) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(count).toBe(1);
    });
  });

  describe('regression: existing browser auth and public redirects are unaffected', () => {
    it('a browser JWT session keeps working exactly as before', async () => {
      const owner = await registerUser('regress1@example.com');

      const res = await request(server)
        .get('/api/v1/links')
        .set({ ...headers(owner), 'X-Workspace-Id': owner.workspaceId });

      expect(res.status).toBe(200);
    });

    it('a public redirect never touches API-key auth or usage tracking', async () => {
      const owner = await registerUser('regress2@example.com');
      await request(server)
        .post('/api/v1/links')
        .set({ ...headers(owner), 'X-Workspace-Id': owner.workspaceId })
        .send({
          destinationUrl: 'https://example.com/plain',
          slug: 'regress2-link',
        })
        .expect(201);

      const res = await request(server).get('/regress2-link').redirects(0);
      expect(res.status).toBe(302);

      const usageCount = await prisma.apiUsageEvent.count({
        where: { workspaceId: owner.workspaceId },
      });
      expect(usageCount).toBe(0);
    });
  });
});
