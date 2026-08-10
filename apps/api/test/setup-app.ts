import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type Redis from 'ioredis';

import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { registerRedirectRoute } from '../src/modules/links/redirect-route';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/modules/redis/redis.module';

/**
 * Boots a real Nest application (real Prisma, real Postgres, real Redis)
 * for e2e tests, mirroring main.ts's bootstrap exactly (including how the
 * redirect route is registered — see redirect-route.ts) so the tested
 * behaviour matches production. Requires DATABASE_URL to point at a
 * disposable test database — see README in this directory.
 *
 * Rate limiting is disabled for this bootstrap via DISABLE_RATE_LIMIT_FOR_TESTS
 * (set in test/jest.e2e.setup.ts, which Jest guarantees runs before this
 * module — and therefore AppModule — is ever imported). This suite exercises
 * business logic (registration, login, RBAC, ...) and legitimately fires far
 * more requests per minute against auth endpoints than the real per-endpoint
 * limits allow (see auth.controller.ts's @Throttle(...) decorators). Rate
 * limiting itself is verified separately, with the real guard fully active,
 * in test/rate-limit.e2e-spec.ts (its own Jest config, no env override).
 */
export async function createTestApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
  redis: Redis;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  registerRedirectRoute(app);
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

  const prisma = app.get(PrismaService);
  const redis = app.get<Redis>(REDIS_CLIENT);
  return { app, prisma, redis };
}

/** Deletes all rows from tables touched by the e2e suites, in
 * FK-dependency order (children before parents), and flushes Redis —
 * link caching means stale entries from a previous run (deterministic
 * test slugs) would otherwise leak into the next one, unlike Postgres
 * which we always run against a freshly recreated database. */
export async function resetDatabase(
  prisma: PrismaService,
  redis?: Redis,
): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.clickEvent.deleteMany();
  await prisma.linkDailyStat.deleteMany();
  await prisma.link.deleteMany();
  await prisma.workspaceMember.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();
  if (redis) {
    await redis.flushdb();
  }
}
