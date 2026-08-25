import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import request from 'supertest';

import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

describe('Report preferences (e2e)', () => {
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
    return { accessToken: res.body.accessToken as string, userId: res.body.user.id as string };
  }

  function auth(actor: { accessToken: string }) {
    return { Authorization: `Bearer ${actor.accessToken}` };
  }

  it('requires authentication', async () => {
    await request(server).get('/api/v1/users/me/report-preferences').expect(401);
  });

  it('lazily creates default preferences (disabled, weekly, Monday, 09:00 UTC) on first read', async () => {
    const user = await registerUser('prefs1@example.com');

    const res = await request(server)
      .get('/api/v1/users/me/report-preferences')
      .set(auth(user))
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        emailReportsEnabled: false,
        frequency: 'WEEKLY',
        reportDay: 'MONDAY',
        reportHourUtc: 9,
      }),
    );
  });

  it('updates preferences and persists the change', async () => {
    const user = await registerUser('prefs2@example.com');

    await request(server)
      .patch('/api/v1/users/me/report-preferences')
      .set(auth(user))
      .send({ emailReportsEnabled: true, frequency: 'DAILY', reportHourUtc: 14 })
      .expect(200);

    const res = await request(server)
      .get('/api/v1/users/me/report-preferences')
      .set(auth(user))
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        emailReportsEnabled: true,
        frequency: 'DAILY',
        reportHourUtc: 14,
      }),
    );
  });

  it('rejects an out-of-range reportHourUtc', async () => {
    const user = await registerUser('prefs3@example.com');
    await request(server)
      .patch('/api/v1/users/me/report-preferences')
      .set(auth(user))
      .send({ reportHourUtc: 24 })
      .expect(400);
  });

  it('rejects an invalid reportDay value', async () => {
    const user = await registerUser('prefs4@example.com');
    await request(server)
      .patch('/api/v1/users/me/report-preferences')
      .set(auth(user))
      .send({ frequency: 'WEEKLY', reportDay: 'FUNDAY' })
      .expect(400);
  });

  it('keeps each user\'s preferences fully isolated from another user\'s', async () => {
    const userA = await registerUser('prefs-a@example.com');
    const userB = await registerUser('prefs-b@example.com');

    await request(server)
      .patch('/api/v1/users/me/report-preferences')
      .set(auth(userA))
      .send({ emailReportsEnabled: true, frequency: 'DAILY', reportHourUtc: 3 })
      .expect(200);

    const bRes = await request(server)
      .get('/api/v1/users/me/report-preferences')
      .set(auth(userB))
      .expect(200);

    expect(bRes.body).toEqual(
      expect.objectContaining({ emailReportsEnabled: false, frequency: 'WEEKLY' }),
    );
  });
});
