import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  GlobalRole,
  PlanTier,
  SubscriptionStatus,
  WorkspaceRole,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { seedPlans } from '../prisma/seed';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { generateApiKey } from '../src/common/utils/api-key';
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

    // Registration requires a FREE plan to exist (Sprint 7) — this file
    // doesn't go through setup-app.ts::createTestApp(), so it needs its
    // own seed just like that helper does.
    await seedPlans(prisma);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it('tracks an API key by its own id (not source IP), and blocks it at the configured global limit with a structured 429', async () => {
    // Set up the workspace + key directly via Prisma rather than through
    // /auth/register or the api-keys HTTP endpoint — this test's whole
    // point is exercising the /links throttle bucket, and going through
    // HTTP for setup would otherwise consume slots from the shared,
    // per-IP /auth/register bucket the test below deliberately exhausts.
    const freePlan = await prisma.plan.findFirstOrThrow({
      where: { tier: PlanTier.FREE },
    });
    const user = await prisma.user.create({
      data: {
        email: 'ratelimit-apikey@example.com',
        passwordHash: 'unused-not-logged-in-via-password',
        firstName: 'Rate',
        lastName: 'Limit',
        globalRole: GlobalRole.USER,
        emailVerified: true,
      },
    });
    const organization = await prisma.organization.create({
      data: {
        name: 'Rate Limit Org',
        slug: 'rate-limit-org',
        ownerId: user.id,
      },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Rate Limit Workspace',
        slug: 'main',
        organizationId: organization.id,
      },
    });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: WorkspaceRole.OWNER,
      },
    });
    await prisma.subscription.create({
      data: {
        workspaceId: workspace.id,
        planId: freePlan.id,
        status: SubscriptionStatus.ACTIVE,
      },
    });
    const { rawKey, keyPrefix, keyHash } = generateApiKey();
    await prisma.apiKey.create({
      data: {
        workspaceId: workspace.id,
        name: 'Rate Limit Test Key',
        keyPrefix,
        keyHash,
        permissions: ['LINKS_READ'],
        createdById: user.id,
      },
    });

    // THROTTLE_LIMIT defaults to 100/min (see app.module.ts) — no
    // per-route @Throttle override applies to /links, so exactly 100
    // requests within the window succeed and the 101st is blocked.
    const statuses: number[] = [];
    let structuredBody: Record<string, unknown> | undefined;
    for (let i = 0; i < 101; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(server)
        .get('/api/v1/links')
        .set('Authorization', `Bearer ${rawKey}`);
      statuses.push(res.status);
      if (res.status === 429 && !structuredBody) {
        structuredBody = res.body;
      }
    }

    expect(statuses.filter((s) => s === 200)).toHaveLength(100);
    expect(statuses.filter((s) => s === 429)).toHaveLength(1);
    expect(structuredBody).toMatchObject({ code: 'API_RATE_LIMIT_EXCEEDED' });
  }, 30000);

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
