import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';

import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/modules/prisma/prisma.service';

/**
 * Boots a real Nest application (real Prisma, real Postgres, real Redis)
 * for e2e tests, mirroring main.ts's bootstrap exactly so the tested
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
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
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
  return { app, prisma };
}

/** Deletes all rows from tables touched by the auth/workspace e2e suites,
 * in FK-dependency order (children before parents). */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.workspaceMember.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();
}
