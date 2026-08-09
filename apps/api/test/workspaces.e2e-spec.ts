import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

describe('Workspaces (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
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

  describe('POST /workspaces', () => {
    it('rejects unauthenticated requests (401)', async () => {
      await request(server)
        .post('/api/v1/workspaces')
        .send({ name: 'New Workspace' })
        .expect(401);
    });

    it('creates a workspace with the caller as OWNER', async () => {
      const owner = await registerUser('owner@example.com');

      const res = await request(server)
        .post('/api/v1/workspaces')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: 'Second Workspace' })
        .expect(201);

      expect(res.body.name).toBe('Second Workspace');

      const list = await request(server)
        .get('/api/v1/workspaces')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      expect(list.body).toHaveLength(2); // registration workspace + this one
      expect(list.body.every((w: { role: string }) => w.role === 'OWNER')).toBe(
        true,
      );
    });
  });

  describe('GET /workspaces/:workspaceId — membership boundary', () => {
    it('allows a member to read the workspace', async () => {
      const owner = await registerUser('owner2@example.com');

      await request(server)
        .get(`/api/v1/workspaces/${owner.workspaceId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);
    });

    it('rejects a non-member with 403 (forbidden, not just unauthenticated)', async () => {
      const owner = await registerUser('owner3@example.com');
      const outsider = await registerUser('outsider@example.com');

      const res = await request(server)
        .get(`/api/v1/workspaces/${owner.workspaceId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .expect(403);

      expect(res.body.message).toMatch(/not a member/i);
    });

    it('rejects an unauthenticated request with 401 (not 403)', async () => {
      const owner = await registerUser('owner4@example.com');
      await request(server)
        .get(`/api/v1/workspaces/${owner.workspaceId}`)
        .expect(401);
    });
  });

  describe('Role enforcement on mutating endpoints', () => {
    async function setupWorkspaceWithMember(
      role: 'ADMIN' | 'MEMBER' | 'VIEWER',
    ) {
      const owner = await registerUser(`owner-${role}@example.com`);
      const memberAccount = await registerUser(`member-${role}@example.com`);

      // Owner invites memberAccount into their workspace at the given role.
      await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/members/invite`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: `member-${role}@example.com`, role })
        .expect(201);

      return { owner, member: memberAccount };
    }

    it('MEMBER cannot update workspace settings (403)', async () => {
      const { member, owner } = await setupWorkspaceWithMember('MEMBER');

      await request(server)
        .patch(`/api/v1/workspaces/${owner.workspaceId}`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ name: 'Hacked Name' })
        .expect(403);
    });

    it('VIEWER cannot invite members (403)', async () => {
      const { member, owner } = await setupWorkspaceWithMember('VIEWER');

      await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/members/invite`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ email: 'someone-else@example.com' })
        .expect(403);
    });

    it('ADMIN can update workspace settings and invite members', async () => {
      const { member, owner } = await setupWorkspaceWithMember('ADMIN');

      await request(server)
        .patch(`/api/v1/workspaces/${owner.workspaceId}`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ name: 'Updated By Admin' })
        .expect(200);

      await registerUser('invitee@example.com');
      await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/members/invite`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ email: 'invitee@example.com' })
        .expect(201);
    });

    it('VIEWER can still read workspace members (read-only access works)', async () => {
      const { member, owner } = await setupWorkspaceWithMember('VIEWER');

      await request(server)
        .get(`/api/v1/workspaces/${owner.workspaceId}/members`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .expect(200);
    });
  });

  describe('Member invitation edge cases', () => {
    it('returns 404 when inviting an email with no LinkIQ account', async () => {
      const owner = await registerUser('owner5@example.com');

      const res = await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/members/invite`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: 'nonexistent@example.com' })
        .expect(404);

      expect(res.body.message).toMatch(/no linkiq account/i);
    });

    it('returns 409 when inviting an existing member again', async () => {
      const owner = await registerUser('owner6@example.com');
      await registerUser('already-member@example.com');

      await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/members/invite`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: 'already-member@example.com' })
        .expect(201);

      await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/members/invite`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: 'already-member@example.com' })
        .expect(409);
    });
  });

  describe('Last-owner protection', () => {
    it('refuses to remove the sole owner', async () => {
      const owner = await registerUser('sole-owner@example.com');
      const membership = await prisma.workspaceMember.findFirstOrThrow({
        where: { workspaceId: owner.workspaceId, userId: owner.userId },
      });

      await request(server)
        .delete(
          `/api/v1/workspaces/${owner.workspaceId}/members/${membership.id}`,
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(400);
    });

    it('allows removing an owner once a second owner exists', async () => {
      const owner = await registerUser('owner-a@example.com');
      await registerUser('owner-b@example.com');

      await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/members/invite`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: 'owner-b@example.com', role: 'ADMIN' });

      const newMember = await prisma.workspaceMember.findFirstOrThrow({
        where: {
          workspaceId: owner.workspaceId,
          user: { email: 'owner-b@example.com' },
        },
      });

      // Promote owner-b to OWNER.
      await request(server)
        .patch(
          `/api/v1/workspaces/${owner.workspaceId}/members/${newMember.id}`,
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ role: 'OWNER' })
        .expect(200);

      const originalOwnerMembership =
        await prisma.workspaceMember.findFirstOrThrow({
          where: { workspaceId: owner.workspaceId, userId: owner.userId },
        });

      // Now removing the original owner should succeed.
      await request(server)
        .delete(
          `/api/v1/workspaces/${owner.workspaceId}/members/${originalOwnerMembership.id}`,
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(204);
    });
  });

  describe('Audit logging', () => {
    it('records workspace.created and workspace.member_invited events', async () => {
      const owner = await registerUser('audit-owner@example.com');
      await registerUser('audit-invitee@example.com');

      await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/members/invite`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: 'audit-invitee@example.com' })
        .expect(201);

      const createdLogs = await prisma.auditLog.findMany({
        where: { action: 'workspace.created', userId: owner.userId },
      });
      const inviteLogs = await prisma.auditLog.findMany({
        where: {
          action: 'workspace.member_invited',
          workspaceId: owner.workspaceId,
        },
      });

      expect(createdLogs.length).toBeGreaterThanOrEqual(1);
      expect(inviteLogs).toHaveLength(1);
      // Audit metadata must never contain secrets.
      expect(JSON.stringify(inviteLogs[0].metadata)).not.toMatch(/password/i);
    });
  });
});
