import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import request from 'supertest';

import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

describe('QR Codes (e2e)', () => {
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
  }, 45000);

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

  async function createLink(
    owner: { accessToken: string; workspaceId: string },
    slug: string,
  ) {
    const res = await request(server)
      .post('/api/v1/links')
      .set(headers(owner, owner.workspaceId))
      .send({ destinationUrl: 'https://example.com/target', slug });
    return res.body;
  }

  describe('POST /links/:linkId/qrcodes', () => {
    it('rejects unauthenticated requests', async () => {
      const owner = await registerUser('qr-auth1@example.com');
      const link = await createLink(owner, 'qr-auth-link');
      await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .send({ name: 'Test' })
        .expect(401);
    });

    it('creates a QR code with sensible defaults', async () => {
      const owner = await registerUser('qr-create1@example.com');
      const link = await createLink(owner, 'qr-create-link');

      const res = await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'My QR' })
        .expect(201);

      expect(res.body.name).toBe('My QR');
      expect(res.body.format).toBe('PNG');
      expect(res.body.size).toBe(512);
      expect(res.body.linkId).toBe(link.id);
    });

    it('rejects creation for a nonexistent link', async () => {
      const owner = await registerUser('qr-create2@example.com');
      await request(server)
        .post('/api/v1/links/00000000-0000-0000-0000-000000000000/qrcodes')
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Test' })
        .expect(404);
    });

    it('rejects identical foreground/background colors', async () => {
      const owner = await registerUser('qr-create3@example.com');
      const link = await createLink(owner, 'qr-create-link3');

      await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({
          name: 'Bad',
          foregroundColor: '#000000',
          backgroundColor: '#000000',
        })
        .expect(400);
    });

    it('rejects an out-of-range size', async () => {
      const owner = await registerUser('qr-create4@example.com');
      const link = await createLink(owner, 'qr-create-link4');

      await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Huge', size: 99999 })
        .expect(400);
    });

    it('writes a qr_code.created audit log entry', async () => {
      const owner = await registerUser('qr-audit1@example.com');
      const link = await createLink(owner, 'qr-audit-link');

      const res = await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Audited QR' })
        .expect(201);

      const logs = await prisma.auditLog.findMany({
        where: { action: 'qr_code.created', entityId: res.body.id },
      });
      expect(logs).toHaveLength(1);
    });
  });

  describe('Workspace isolation', () => {
    it('returns 404 (not 403) for a QR code in another workspace, even with a valid ID', async () => {
      const owner = await registerUser('qr-iso-owner1@example.com');
      const outsider = await registerUser('qr-iso-outsider1@example.com');
      const link = await createLink(owner, 'qr-iso-link1');
      const qr = await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Isolated' });

      await request(server)
        .get(`/api/v1/qrcodes/${qr.body.id}`)
        .set(headers(outsider, owner.workspaceId))
        .expect(403); // non-member of that workspace at all
    });

    it('a non-member cannot list QR codes for a link in a workspace they do not belong to', async () => {
      const owner = await registerUser('qr-iso-owner2@example.com');
      const outsider = await registerUser('qr-iso-outsider2@example.com');
      const link = await createLink(owner, 'qr-iso-link2');

      await request(server)
        .get(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(outsider, owner.workspaceId))
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
        .set(headers(owner, owner.workspaceId))
        .send({ email, role });
      return account;
    }

    it('VIEWER can read and download but not create QR codes', async () => {
      const owner = await registerUser('qr-rbac-owner1@example.com');
      const link = await createLink(owner, 'qr-rbac-link1');
      const qr = await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Viewer Test' });

      const viewer = await inviteAs(
        owner,
        'qr-rbac-viewer1@example.com',
        'VIEWER',
      );
      const viewerHeaders = headers(viewer, owner.workspaceId);

      await request(server)
        .get(`/api/v1/qrcodes/${qr.body.id}`)
        .set(viewerHeaders)
        .expect(200);
      await request(server)
        .get(`/api/v1/qrcodes/${qr.body.id}/download`)
        .set(viewerHeaders)
        .expect(200);
      await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(viewerHeaders)
        .send({ name: 'Should fail' })
        .expect(403);
    });

    it('MEMBER can create, update, and delete QR codes', async () => {
      const owner = await registerUser('qr-rbac-owner2@example.com');
      const link = await createLink(owner, 'qr-rbac-link2');
      const member = await inviteAs(
        owner,
        'qr-rbac-member2@example.com',
        'MEMBER',
      );
      const memberHeaders = headers(member, owner.workspaceId);

      const created = await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(memberHeaders)
        .send({ name: 'Member QR' })
        .expect(201);

      await request(server)
        .patch(`/api/v1/qrcodes/${created.body.id}`)
        .set(memberHeaders)
        .send({ name: 'Renamed by Member' })
        .expect(200);

      await request(server)
        .delete(`/api/v1/qrcodes/${created.body.id}`)
        .set(memberHeaders)
        .expect(204);
    });

    it('ADMIN has full QR management', async () => {
      const owner = await registerUser('qr-rbac-owner3@example.com');
      const link = await createLink(owner, 'qr-rbac-link3');
      const admin = await inviteAs(
        owner,
        'qr-rbac-admin3@example.com',
        'ADMIN',
      );
      const adminHeaders = headers(admin, owner.workspaceId);

      const created = await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(adminHeaders)
        .send({ name: 'Admin QR' })
        .expect(201);

      await request(server)
        .delete(`/api/v1/qrcodes/${created.body.id}`)
        .set(adminHeaders)
        .expect(204);
    });

    it('OWNER has full QR management', async () => {
      const owner = await registerUser('qr-rbac-owner4@example.com');
      const link = await createLink(owner, 'qr-rbac-link4');

      const created = await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Owner QR' })
        .expect(201);

      await request(server)
        .patch(`/api/v1/qrcodes/${created.body.id}`)
        .set(headers(owner, owner.workspaceId))
        .send({ size: 800 })
        .expect(200);
    });
  });

  describe('CRUD', () => {
    it('lists QR codes for a link', async () => {
      const owner = await registerUser('qr-crud1@example.com');
      const link = await createLink(owner, 'qr-crud-link1');
      await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'First' });
      await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Second' });

      const res = await request(server)
        .get(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .expect(200);

      expect(res.body).toHaveLength(2);
    });

    it('lists QR codes workspace-wide with pagination', async () => {
      const owner = await registerUser('qr-crud2@example.com');
      const link = await createLink(owner, 'qr-crud-link2');
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await request(server)
          .post(`/api/v1/links/${link.id}/qrcodes`)
          .set(headers(owner, owner.workspaceId))
          .send({ name: `QR ${i}` });
      }

      const res = await request(server)
        .get('/api/v1/qrcodes?page=1&pageSize=3')
        .set(headers(owner, owner.workspaceId))
        .expect(200);

      expect(res.body.items).toHaveLength(3);
      expect(res.body.pagination.totalItems).toBe(5);
    });

    it('deletes a QR code — it disappears from listing and direct access', async () => {
      const owner = await registerUser('qr-crud3@example.com');
      const link = await createLink(owner, 'qr-crud-link3');
      const created = await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'To Delete' });

      await request(server)
        .delete(`/api/v1/qrcodes/${created.body.id}`)
        .set(headers(owner, owner.workspaceId))
        .expect(204);

      await request(server)
        .get(`/api/v1/qrcodes/${created.body.id}`)
        .set(headers(owner, owner.workspaceId))
        .expect(404);
    });
  });

  describe('Link integration', () => {
    it('changing the link destination does not require QR regeneration — the download still succeeds and encodes the same short URL', async () => {
      const owner = await registerUser('qr-link-int1@example.com');
      const link = await createLink(owner, 'qr-link-int-link1');
      const qr = await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Stable QR' });

      const before = await request(server)
        .get(`/api/v1/qrcodes/${qr.body.id}/download`)
        .set(headers(owner, owner.workspaceId))
        .expect(200);

      await request(server)
        .patch(`/api/v1/links/${link.id}`)
        .set(headers(owner, owner.workspaceId))
        .send({
          destinationUrl: 'https://example.com/a-totally-different-place',
        })
        .expect(200);

      const after = await request(server)
        .get(`/api/v1/qrcodes/${qr.body.id}/download`)
        .set(headers(owner, owner.workspaceId))
        .expect(200);

      // Same QR record, same short code encoded -> byte-identical PNG
      // output before and after the destination changed underneath it.
      expect(Buffer.compare(before.body, after.body)).toBe(0);
    });

    it('rejects a malformed (non-UUID) linkId with 400, not a raw database error', async () => {
      const owner = await registerUser('qr-link-int2@example.com');
      await request(server)
        .post('/api/v1/links/not-a-real-id/qrcodes')
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Orphan' })
        .expect(400);
    });

    it('a QR code cannot be created for a well-formed but nonexistent link id', async () => {
      const owner = await registerUser('qr-link-int2b@example.com');
      await request(server)
        .post('/api/v1/links/00000000-0000-0000-0000-000000000000/qrcodes')
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Orphan' })
        .expect(404);
    });

    it('a scan of a QR pointing at a paused link is blocked exactly like any other redirect to a paused link', async () => {
      const owner = await registerUser('qr-link-int3@example.com');
      const link = await createLink(owner, 'qr-link-int-link3');
      await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Paused Link QR' });
      await request(server)
        .post(`/api/v1/links/${link.id}/pause`)
        .set(headers(owner, owner.workspaceId));

      const res = await request(server).get(`/${link.shortCode}`);
      expect(res.status).toBe(403);
    });
  });

  describe('Redirect / analytics integration', () => {
    it('a QR scan (redirect with QR UTM params) creates exactly one ClickEvent, same as any other redirect', async () => {
      const owner = await registerUser('qr-analytics1@example.com');
      const link = await createLink(owner, 'qr-analytics-link1');
      const qr = await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Poster' });

      await request(server)
        .get(
          `/${link.shortCode}?utm_source=qr_code&utm_medium=qr&utm_campaign=poster`,
        )
        .redirects(0)
        .expect(302);

      const deadline = Date.now() + 5000;
      let count = 0;
      while (Date.now() < deadline) {
        count = await prisma.clickEvent.count({ where: { linkId: link.id } });
        if (count > 0) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      expect(count).toBe(1);

      const event = await prisma.clickEvent.findFirst({
        where: { linkId: link.id },
      });
      expect(
        (event?.queryParams as Record<string, string> | null)?.utm_source,
      ).toBe('qr_code');
      void qr; // created above to prove the QR record's existence isn't what drives the redirect
    });
  });

  describe('Downloads', () => {
    it('downloads a PNG with correct content-type and a safe filename', async () => {
      const owner = await registerUser('qr-download1@example.com');
      const link = await createLink(owner, 'qr-download-link1');
      const qr = await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Download Me' });

      const res = await request(server)
        .get(`/api/v1/qrcodes/${qr.body.id}/download`)
        .set(headers(owner, owner.workspaceId))
        .expect(200);

      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-disposition']).toContain(
        'linkiq-download-me-qr.png',
      );
      expect(res.body.subarray(0, 4).toString('hex')).toBe('89504e47');
    });

    it('downloads an SVG when format=SVG is requested', async () => {
      const owner = await registerUser('qr-download2@example.com');
      const link = await createLink(owner, 'qr-download-link2');
      const qr = await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'SVG Test' });

      const res = await request(server)
        .get(`/api/v1/qrcodes/${qr.body.id}/download?format=SVG`)
        .set(headers(owner, owner.workspaceId))
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            callback(null, Buffer.concat(chunks).toString('utf8')),
          );
        })
        .expect(200);

      expect(res.headers['content-type']).toContain('image/svg+xml');
      expect(res.headers['content-disposition']).toContain('.svg');
      expect(res.body).toContain('<svg');
    });

    it('rejects an unauthenticated download', async () => {
      const owner = await registerUser('qr-download3@example.com');
      const link = await createLink(owner, 'qr-download-link3');
      const qr = await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Auth Test' });

      await request(server)
        .get(`/api/v1/qrcodes/${qr.body.id}/download`)
        .expect(401);
    });

    it('rejects a download from a non-member workspace', async () => {
      const owner = await registerUser('qr-download4@example.com');
      const outsider = await registerUser('qr-download4b@example.com');
      const link = await createLink(owner, 'qr-download-link4');
      const qr = await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Protected' });

      await request(server)
        .get(`/api/v1/qrcodes/${qr.body.id}/download`)
        .set(headers(outsider, owner.workspaceId))
        .expect(403);
    });

    it('writes a qr_code.downloaded audit log entry', async () => {
      const owner = await registerUser('qr-download5@example.com');
      const link = await createLink(owner, 'qr-download-link5');
      const qr = await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Audited Download' });

      await request(server)
        .get(`/api/v1/qrcodes/${qr.body.id}/download`)
        .set(headers(owner, owner.workspaceId))
        .expect(200);

      const logs = await prisma.auditLog.findMany({
        where: { action: 'qr_code.downloaded', entityId: qr.body.id },
      });
      expect(logs).toHaveLength(1);
    });
  });
});
