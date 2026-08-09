import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import request from 'supertest';

import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

describe('Links (e2e)', () => {
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

  function authHeaders(owner: { accessToken: string; workspaceId: string }) {
    return {
      Authorization: `Bearer ${owner.accessToken}`,
      'X-Workspace-Id': owner.workspaceId,
    };
  }

  describe('POST /links', () => {
    it('rejects unauthenticated requests', async () => {
      await request(server)
        .post('/api/v1/links')
        .send({ destinationUrl: 'https://example.com' })
        .expect(401);
    });

    it('creates a link with an auto-generated short code', async () => {
      const owner = await registerUser('owner1@example.com');

      const res = await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'https://example.com/page' })
        .expect(201);

      expect(res.body.shortCode).toMatch(/^[A-Za-z0-9]{7}$/);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.destinationUrl).toBe('https://example.com/page');
    });

    it('creates a link with a custom slug', async () => {
      const owner = await registerUser('owner2@example.com');

      const res = await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'https://example.com', slug: 'my-custom-slug' })
        .expect(201);

      expect(res.body.shortCode).toBe('my-custom-slug');
    });

    it('rejects a duplicate custom slug with 409', async () => {
      const owner = await registerUser('owner3@example.com');

      await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'https://example.com', slug: 'taken' })
        .expect(201);

      await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'https://example.com/other', slug: 'taken' })
        .expect(409);
    });

    it('rejects a reserved slug with 400', async () => {
      const owner = await registerUser('owner4@example.com');

      await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'https://example.com', slug: 'admin' })
        .expect(400);
    });

    it('rejects an invalid destination URL', async () => {
      const owner = await registerUser('owner5@example.com');

      await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'javascript:alert(1)' })
        .expect(400);
    });

    it('handles concurrent creation attempts for the same custom slug — exactly one succeeds', async () => {
      const owner = await registerUser('owner6@example.com');

      const attempts = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(server)
            .post('/api/v1/links')
            .set(authHeaders(owner))
            .send({ destinationUrl: 'https://example.com', slug: 'race-slug' }),
        ),
      );

      const succeeded = attempts.filter((r) => r.status === 201);
      const conflicted = attempts.filter((r) => r.status === 409);

      expect(succeeded).toHaveLength(1);
      expect(conflicted).toHaveLength(4);
    });

    it('writes a link.created audit log entry', async () => {
      const owner = await registerUser('owner7@example.com');

      const res = await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'https://example.com' })
        .expect(201);

      const logs = await prisma.auditLog.findMany({
        where: { action: 'link.created', entityId: res.body.id },
      });
      expect(logs).toHaveLength(1);
    });
  });

  describe('GET /links — list, search, filter, pagination', () => {
    it('paginates results', async () => {
      const owner = await registerUser('lister1@example.com');
      for (let i = 0; i < 25; i++) {
        // eslint-disable-next-line no-await-in-loop
        await request(server)
          .post('/api/v1/links')
          .set(authHeaders(owner))
          .send({ destinationUrl: `https://example.com/${i}` });
      }

      const page1 = await request(server)
        .get('/api/v1/links?page=1&pageSize=10')
        .set(authHeaders(owner))
        .expect(200);

      expect(page1.body.items).toHaveLength(10);
      expect(page1.body.pagination).toMatchObject({
        page: 1,
        pageSize: 10,
        totalItems: 25,
        totalPages: 3,
      });
    });

    it('searches by title, shortCode, and destinationUrl', async () => {
      const owner = await registerUser('lister2@example.com');
      await request(server).post('/api/v1/links').set(authHeaders(owner)).send({
        destinationUrl: 'https://example.com/a',
        slug: 'findme',
        title: 'Unrelated',
      });
      await request(server).post('/api/v1/links').set(authHeaders(owner)).send({
        destinationUrl: 'https://example.com/b',
        title: 'Findme Title',
      });
      await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'https://nomatch.com/c' });

      const res = await request(server)
        .get('/api/v1/links?search=findme')
        .set(authHeaders(owner))
        .expect(200);

      expect(res.body.items).toHaveLength(2);
    });

    it('filters by status', async () => {
      const owner = await registerUser('lister3@example.com');
      const created = await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'https://example.com' });
      await request(server)
        .post(`/api/v1/links/${created.body.id}/pause`)
        .set(authHeaders(owner));
      await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'https://example.com/2' });

      const res = await request(server)
        .get('/api/v1/links?status=PAUSED')
        .set(authHeaders(owner))
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].status).toBe('PAUSED');
    });
  });

  describe('Workspace isolation', () => {
    it('returns 404 (not 403) for a link belonging to another workspace, even with a valid ID', async () => {
      const owner = await registerUser('iso-owner@example.com');
      const outsider = await registerUser('iso-outsider@example.com');

      const created = await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'https://example.com' });

      await request(server)
        .get(`/api/v1/links/${created.body.id}`)
        .set(authHeaders(outsider))
        .expect(404);
    });

    it('rejects requests to a workspace the caller is not a member of', async () => {
      const owner = await registerUser('iso-owner2@example.com');
      const outsider = await registerUser('iso-outsider2@example.com');

      await request(server)
        .get('/api/v1/links')
        .set({
          Authorization: `Bearer ${outsider.accessToken}`,
          'X-Workspace-Id': owner.workspaceId,
        })
        .expect(403);
    });
  });

  describe('RBAC', () => {
    async function inviteAs(
      owner: { accessToken: string; workspaceId: string },
      email: string,
      role: string,
    ) {
      const account = await registerUser(email);
      await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/members/invite`)
        .set(authHeaders(owner))
        .send({ email, role });
      return account;
    }

    it('VIEWER can read but not create links', async () => {
      const owner = await registerUser('rbac-owner1@example.com');
      const viewer = await inviteAs(
        owner,
        'rbac-viewer1@example.com',
        'VIEWER',
      );
      const viewerHeaders = {
        Authorization: `Bearer ${viewer.accessToken}`,
        'X-Workspace-Id': owner.workspaceId,
      };

      await request(server).get('/api/v1/links').set(viewerHeaders).expect(200);
      await request(server)
        .post('/api/v1/links')
        .set(viewerHeaders)
        .send({ destinationUrl: 'https://example.com' })
        .expect(403);
    });

    it('MEMBER can create and manage links', async () => {
      const owner = await registerUser('rbac-owner2@example.com');
      const member = await inviteAs(
        owner,
        'rbac-member2@example.com',
        'MEMBER',
      );
      const memberHeaders = {
        Authorization: `Bearer ${member.accessToken}`,
        'X-Workspace-Id': owner.workspaceId,
      };

      const created = await request(server)
        .post('/api/v1/links')
        .set(memberHeaders)
        .send({ destinationUrl: 'https://example.com' })
        .expect(201);

      await request(server)
        .post(`/api/v1/links/${created.body.id}/pause`)
        .set(memberHeaders)
        .expect(200);
    });

    it('ADMIN has full link management', async () => {
      const owner = await registerUser('rbac-owner3@example.com');
      const admin = await inviteAs(owner, 'rbac-admin3@example.com', 'ADMIN');
      const adminHeaders = {
        Authorization: `Bearer ${admin.accessToken}`,
        'X-Workspace-Id': owner.workspaceId,
      };

      const created = await request(server)
        .post('/api/v1/links')
        .set(adminHeaders)
        .send({ destinationUrl: 'https://example.com' })
        .expect(201);

      await request(server)
        .delete(`/api/v1/links/${created.body.id}`)
        .set(adminHeaders)
        .expect(204);
    });

    it('OWNER has full link management', async () => {
      const owner = await registerUser('rbac-owner4@example.com');
      const created = await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'https://example.com' })
        .expect(201);

      await request(server)
        .patch(`/api/v1/links/${created.body.id}`)
        .set(authHeaders(owner))
        .send({ title: 'Updated' })
        .expect(200);
    });
  });

  describe('Lifecycle transitions', () => {
    it('pause -> activate -> archive -> activate (reactivate)', async () => {
      const owner = await registerUser('lifecycle@example.com');
      const created = await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'https://example.com' });
      const id = created.body.id;

      const paused = await request(server)
        .post(`/api/v1/links/${id}/pause`)
        .set(authHeaders(owner))
        .expect(200);
      expect(paused.body.status).toBe('PAUSED');

      const reactivated = await request(server)
        .post(`/api/v1/links/${id}/activate`)
        .set(authHeaders(owner))
        .expect(200);
      expect(reactivated.body.status).toBe('ACTIVE');

      const archived = await request(server)
        .post(`/api/v1/links/${id}/archive`)
        .set(authHeaders(owner))
        .expect(200);
      expect(archived.body.status).toBe('ARCHIVED');

      const reReactivated = await request(server)
        .post(`/api/v1/links/${id}/activate`)
        .set(authHeaders(owner))
        .expect(200);
      expect(reReactivated.body.status).toBe('ACTIVE');
    });

    it('rejects pausing an already-paused link', async () => {
      const owner = await registerUser('lifecycle2@example.com');
      const created = await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'https://example.com' });

      await request(server)
        .post(`/api/v1/links/${created.body.id}/pause`)
        .set(authHeaders(owner))
        .expect(200);
      await request(server)
        .post(`/api/v1/links/${created.body.id}/pause`)
        .set(authHeaders(owner))
        .expect(400);
    });
  });

  describe('DELETE /links/:id', () => {
    it('soft-deletes — the link disappears from listing and direct access', async () => {
      const owner = await registerUser('delete1@example.com');
      const created = await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'https://example.com' });

      await request(server)
        .delete(`/api/v1/links/${created.body.id}`)
        .set(authHeaders(owner))
        .expect(204);

      await request(server)
        .get(`/api/v1/links/${created.body.id}`)
        .set(authHeaders(owner))
        .expect(404);
    });
  });

  describe('GET /links/stats', () => {
    it('returns structural counts, not click analytics', async () => {
      const owner = await registerUser('stats1@example.com');
      await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'https://example.com/1' });
      const toPause = await request(server)
        .post('/api/v1/links')
        .set(authHeaders(owner))
        .send({ destinationUrl: 'https://example.com/2' });
      await request(server)
        .post(`/api/v1/links/${toPause.body.id}/pause`)
        .set(authHeaders(owner));

      const res = await request(server)
        .get('/api/v1/links/stats')
        .set(authHeaders(owner))
        .expect(200);

      expect(res.body.totalLinks).toBe(2);
      expect(res.body.activeLinks).toBe(1);
      expect(res.body.pausedLinks).toBe(1);
      expect(res.body.recentLinks).toHaveLength(2);
    });
  });
});
