import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/modules/prisma/prisma.service';

import { resetDatabase } from './setup-app';

/**
 * Unlike the other e2e suites, this one deliberately does NOT override
 * ThrottlerGuard — the whole point is to exercise the real guard and
 * prove the configured limits are actually enforced end-to-end.
 */
describe('Rate limiting (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it('blocks login attempts after the configured limit (5/min) with 429', async () => {
    const attempt = () =>
      request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong-password' });

    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await attempt();
      statuses.push(res.status);
    }

    const unauthorizedCount = statuses.filter((s) => s === 401).length;
    const throttledCount = statuses.filter((s) => s === 429).length;

    expect(unauthorizedCount).toBe(5);
    expect(throttledCount).toBe(2);
  });

  it('blocks registration attempts after the configured limit (5/min) with 429', async () => {
    const attempt = (email: string) =>
      request(server).post('/api/v1/auth/register').send({
        firstName: 'Rate',
        lastName: 'Limit',
        email,
        password: 'SecurePass123',
        passwordConfirmation: 'SecurePass123',
        termsAccepted: true,
      });

    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await attempt(`ratelimit-${i}@example.com`);
      statuses.push(res.status);
    }

    const createdCount = statuses.filter((s) => s === 201).length;
    const throttledCount = statuses.filter((s) => s === 429).length;

    expect(createdCount).toBe(5);
    expect(throttledCount).toBe(2);
  });
});
