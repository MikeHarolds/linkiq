import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import request from 'supertest';

import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

describe('Email verification (e2e)', () => {
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

  const registration = {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    password: 'SecurePass123',
    passwordConfirmation: 'SecurePass123',
    termsAccepted: true,
  };

  it('queues a WELCOME and a VERIFICATION email on registration', async () => {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send(registration)
      .expect(201);

    const logs = await prisma.emailLog.findMany({
      where: { recipientUserId: res.body.user.id },
      orderBy: { type: 'asc' },
    });
    const types = logs.map((l) => l.type).sort();
    expect(types).toEqual(['VERIFICATION', 'WELCOME']);
  });

  it('verifies successfully with the real (unhashed) token and flips emailVerified', async () => {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send(registration)
      .expect(201);

    expect(res.body.user.emailVerified).toBe(false);

    // The raw token is only ever delivered via email (never returned by
    // the API — only its hash is stored), so this reads it back the same
    // way a real recipient would: from the queued VERIFICATION email's
    // template metadata (EmailLog.metadata.verificationUrl).
    const log = await prisma.emailLog.findFirstOrThrow({
      where: { recipientUserId: res.body.user.id, type: 'VERIFICATION' },
    });
    const metadata = log.metadata as { verificationUrl: string };
    const token = new URL(metadata.verificationUrl).searchParams.get('token')!;

    await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(200);

    const me = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(me.body.user.emailVerified).toBe(true);
  });

  it('rejects an unknown token', async () => {
    await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'not-a-real-token' })
      .expect(401);
  });

  it('rejects an expired token', async () => {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send(registration)
      .expect(201);

    await prisma.emailVerificationToken.updateMany({
      where: { userId: res.body.user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const log = await prisma.emailLog.findFirstOrThrow({
      where: { recipientUserId: res.body.user.id, type: 'VERIFICATION' },
    });
    const token = new URL(
      (log.metadata as { verificationUrl: string }).verificationUrl,
    ).searchParams.get('token')!;

    await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(401);
  });

  it('rejects an already-used token (single-use)', async () => {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send(registration)
      .expect(201);

    const log = await prisma.emailLog.findFirstOrThrow({
      where: { recipientUserId: res.body.user.id, type: 'VERIFICATION' },
    });
    const token = new URL(
      (log.metadata as { verificationUrl: string }).verificationUrl,
    ).searchParams.get('token')!;

    await request(server).post('/api/v1/auth/verify-email').send({ token }).expect(200);
    await request(server).post('/api/v1/auth/verify-email').send({ token }).expect(401);
  });

  it('resend-verification requires authentication', async () => {
    await request(server).post('/api/v1/auth/resend-verification').expect(401);
  });

  it('resend-verification issues a fresh token and invalidates the previous one', async () => {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send(registration)
      .expect(201);

    const firstLog = await prisma.emailLog.findFirstOrThrow({
      where: { recipientUserId: res.body.user.id, type: 'VERIFICATION' },
    });
    const firstToken = new URL(
      (firstLog.metadata as { verificationUrl: string }).verificationUrl,
    ).searchParams.get('token')!;

    await request(server)
      .post('/api/v1/auth/resend-verification')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);

    // The original token was invalidated by the resend.
    await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token: firstToken })
      .expect(401);

    const secondLog = await prisma.emailLog.findFirstOrThrow({
      where: { recipientUserId: res.body.user.id, type: 'VERIFICATION' },
      orderBy: { createdAt: 'desc' },
    });
    const secondToken = new URL(
      (secondLog.metadata as { verificationUrl: string }).verificationUrl,
    ).searchParams.get('token')!;

    await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token: secondToken })
      .expect(200);
  });

  it('resend-verification silently no-ops once already verified (no error, no new token)', async () => {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send(registration)
      .expect(201);

    const log = await prisma.emailLog.findFirstOrThrow({
      where: { recipientUserId: res.body.user.id, type: 'VERIFICATION' },
    });
    const token = new URL(
      (log.metadata as { verificationUrl: string }).verificationUrl,
    ).searchParams.get('token')!;
    await request(server).post('/api/v1/auth/verify-email').send({ token }).expect(200);

    const before = await prisma.emailVerificationToken.count({
      where: { userId: res.body.user.id },
    });

    await request(server)
      .post('/api/v1/auth/resend-verification')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);

    const after = await prisma.emailVerificationToken.count({
      where: { userId: res.body.user.id },
    });
    expect(after).toBe(before);
  });

  it('registration still succeeds (email fully disabled by default) and every email is logged SKIPPED', async () => {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send(registration)
      .expect(201);

    const logs = await prisma.emailLog.findMany({
      where: { recipientUserId: res.body.user.id },
    });
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(log.status).toBe('SKIPPED');
    }
  });
});
