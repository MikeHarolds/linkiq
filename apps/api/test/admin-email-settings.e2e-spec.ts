import type { INestApplication } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import type { Redis } from 'ioredis';
import request from 'supertest';

import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

describe('Admin email settings (e2e)', () => {
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
    return { accessToken: res.body.accessToken as string, userId: res.body.user.id as string };
  }

  async function promoteToSuperAdmin(userId: string) {
    await prisma.user.update({ where: { id: userId }, data: { globalRole: GlobalRole.SUPER_ADMIN } });
  }

  function auth(actor: { accessToken: string }) {
    return { Authorization: `Bearer ${actor.accessToken}` };
  }

  describe('Authorization', () => {
    it('denies an unauthenticated request', async () => {
      await request(server).get('/api/v1/admin/email/config').expect(401);
    });

    it('denies a non-admin user with 403', async () => {
      const user = await registerUser('normal@example.com');
      await request(server)
        .get('/api/v1/admin/email/config')
        .set(auth(user))
        .expect(403);
    });

    it('allows a SUPER_ADMIN through', async () => {
      const admin = await registerUser('admin@example.com');
      await promoteToSuperAdmin(admin.userId);
      await request(server)
        .get('/api/v1/admin/email/config')
        .set(auth(admin))
        .expect(200);
    });
  });

  describe('Config read/write', () => {
    it('never returns secret ciphertext, only masked booleans/prefixes', async () => {
      const admin = await registerUser('admin2@example.com');
      await promoteToSuperAdmin(admin.userId);

      await request(server)
        .patch('/api/v1/admin/email/config')
        .set(auth(admin))
        .send({ enabled: true, resendApiKey: 're_super_secret_key_value' })
        .expect(200);

      const res = await request(server)
        .get('/api/v1/admin/email/config')
        .set(auth(admin))
        .expect(200);

      expect(JSON.stringify(res.body)).not.toContain('re_super_secret_key_value');
      expect(res.body.resendApiKeyConfigured).toBe(true);
      expect(res.body.resendApiKeyPrefix).toMatch(/^re_super/);
      expect(res.body.enabled).toBe(true);
    });

    it('omitting resendApiKey on update leaves the previously-stored secret intact', async () => {
      const admin = await registerUser('admin3@example.com');
      await promoteToSuperAdmin(admin.userId);

      await request(server)
        .patch('/api/v1/admin/email/config')
        .set(auth(admin))
        .send({ resendApiKey: 're_original_key' })
        .expect(200);

      await request(server)
        .patch('/api/v1/admin/email/config')
        .set(auth(admin))
        .send({ fromName: 'New Name' })
        .expect(200);

      const res = await request(server)
        .get('/api/v1/admin/email/config')
        .set(auth(admin))
        .expect(200);
      expect(res.body.resendApiKeyConfigured).toBe(true);
      expect(res.body.fromName).toBe('New Name');
    });

    it('defaults every per-type toggle to enabled, and each can be disabled independently', async () => {
      const admin = await registerUser('admin-email-types@example.com');
      await promoteToSuperAdmin(admin.userId);

      const before = await request(server)
        .get('/api/v1/admin/email/config')
        .set(auth(admin))
        .expect(200);
      expect(before.body.welcomeEmailsEnabled).toBe(true);
      expect(before.body.verificationEmailsEnabled).toBe(true);
      expect(before.body.passwordResetEmailsEnabled).toBe(true);
      expect(before.body.reportEmailsEnabled).toBe(true);

      await request(server)
        .patch('/api/v1/admin/email/config')
        .set(auth(admin))
        .send({ welcomeEmailsEnabled: false })
        .expect(200);

      const after = await request(server)
        .get('/api/v1/admin/email/config')
        .set(auth(admin))
        .expect(200);
      expect(after.body.welcomeEmailsEnabled).toBe(false);
      expect(after.body.verificationEmailsEnabled).toBe(true);
    });

    it('never writes a secret to the audit log', async () => {
      const admin = await registerUser('admin4@example.com');
      await promoteToSuperAdmin(admin.userId);

      await request(server)
        .patch('/api/v1/admin/email/config')
        .set(auth(admin))
        .send({ resendApiKey: 're_should_never_appear_in_logs' })
        .expect(200);

      const logs = await prisma.auditLog.findMany({
        where: { action: 'admin.email_config_updated' },
      });
      expect(logs.length).toBeGreaterThan(0);
      expect(JSON.stringify(logs)).not.toContain('re_should_never_appear_in_logs');
    });
  });

  describe('Send test email', () => {
    it('queues a TEST email log for the given recipient', async () => {
      const admin = await registerUser('admin5@example.com');
      await promoteToSuperAdmin(admin.userId);

      await request(server)
        .post('/api/v1/admin/email/send-test')
        .set(auth(admin))
        .send({ to: 'someone@example.com' })
        .expect(201);

      const log = await prisma.emailLog.findFirstOrThrow({
        where: { recipientEmail: 'someone@example.com', type: 'TEST' },
      });
      expect(log).toBeTruthy();
    });
  });

  describe('Logs listing and filters', () => {
    it('lists and filters email logs by status/type/recipient', async () => {
      const admin = await registerUser('admin6@example.com');
      await promoteToSuperAdmin(admin.userId);

      await request(server)
        .post('/api/v1/admin/email/send-test')
        .set(auth(admin))
        .send({ to: 'filter-target@example.com' })
        .expect(201);

      const all = await request(server)
        .get('/api/v1/admin/email/logs')
        .set(auth(admin))
        .expect(200);
      expect(all.body.items.length).toBeGreaterThan(0);
      expect(all.body.pagination).toEqual(
        expect.objectContaining({ page: 1, pageSize: 20 }),
      );

      const filtered = await request(server)
        .get('/api/v1/admin/email/logs')
        .query({ type: 'TEST', recipientEmail: 'filter-target' })
        .set(auth(admin))
        .expect(200);
      expect(filtered.body.items).toHaveLength(1);
      expect(filtered.body.items[0].recipientEmail).toBe('filter-target@example.com');

      const wrongType = await request(server)
        .get('/api/v1/admin/email/logs')
        .query({ type: 'WELCOME', recipientEmail: 'filter-target' })
        .set(auth(admin))
        .expect(200);
      expect(wrongType.body.items).toHaveLength(0);
    });

    it('never exposes EmailLog.metadata — verification/reset emails store the raw token in there', async () => {
      const admin = await registerUser('admin-logs-metadata@example.com');
      await promoteToSuperAdmin(admin.userId);

      // Registration queues a VERIFICATION email whose templateVars
      // (stored as EmailLog.metadata) include verificationUrl?token=<raw>.
      const verificationLog = await prisma.emailLog.findFirstOrThrow({
        where: { recipientEmail: 'admin-logs-metadata@example.com', type: 'VERIFICATION' },
      });
      expect(JSON.stringify(verificationLog.metadata)).toContain('token=');

      const res = await request(server)
        .get('/api/v1/admin/email/logs')
        .query({ recipientEmail: 'admin-logs-metadata' })
        .set(auth(admin))
        .expect(200);

      expect(JSON.stringify(res.body)).not.toContain('token=');
      for (const item of res.body.items) {
        expect(item).not.toHaveProperty('metadata');
      }
    });
  });

  describe('Stats', () => {
    it('reports skipped counts when the service is disabled by default', async () => {
      const admin = await registerUser('admin7@example.com');
      await promoteToSuperAdmin(admin.userId);

      // Registration itself queues WELCOME + VERIFICATION emails, both
      // SKIPPED while the service is disabled (the default state).
      await registerUser('someone-else@example.com');

      const res = await request(server)
        .get('/api/v1/admin/email/stats')
        .query({ range: '30d' })
        .set(auth(admin))
        .expect(200);

      expect(res.body.skipped).toBeGreaterThan(0);
      expect(res.body.sent).toBe(0);
      expect(res.body.failed).toBe(0);
    });
  });
});
