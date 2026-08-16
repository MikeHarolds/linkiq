import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type Redis from 'ioredis';

import {
  seedCountryMappings,
  seedCurrencies,
  seedCurrencySettings,
  seedPlanPrices,
  seedPlans,
  seedPlatformRoles,
} from '../prisma/seed';
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
export async function createTestApp(
  /** Optional hook to override providers before compiling — e.g.
   * substituting PaystackApiClient with a fake so a checkout-flow e2e
   * test never makes a real network call (see
   * paystack-checkout.e2e-spec.ts). Rarely needed; every other e2e file
   * omits it. */
  configureModule?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<{
  app: INestApplication;
  prisma: PrismaService;
  redis: Redis;
}> {
  let builder = Test.createTestingModule({
    imports: [AppModule],
  });
  if (configureModule) {
    builder = configureModule(builder);
  }
  const moduleRef = await builder.compile();

  // rawBody: true mirrors main.ts's bootstrap — required for
  // PaystackWebhookController's signature verification (see
  // paystack-webhooks.e2e-spec.ts), which reads req.rawBody.
  const app = moduleRef.createNestApplication({ rawBody: true });
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

  // Every workspace-creation path (AuthService.register,
  // WorkspacesService.create) requires a FREE plan to exist — reuse the
  // real seed script's plan data so registration works exactly as it does
  // against a real dev database, instead of hand-rolling separate fixture
  // plans that could drift from production. Always re-run this (not
  // guarded behind a "plans already exist" check): resetDatabase() never
  // touches Plan/PlanLimit rows, so a stale row from an earlier run would
  // otherwise silently outlive a PLAN_CONFIGS edit for the rest of this
  // shared test database's life. seedPlans() upserts everything in two
  // parallel batches rather than ~40 sequential round trips specifically
  // so this stays cheap enough to call unconditionally on every file.
  const plans = await seedPlans(prisma);
  // Sprint 15 — same unconditional-reseed rationale as seedPlans() above:
  // resetDatabase() never touches PlatformRole/RolePermission rows either,
  // so every e2e file gets the canonical system roles + plan attachments
  // regardless of what a previous file's run left behind.
  await seedPlatformRoles(prisma, plans);
  // Sprint 16 — same rationale again: resetDatabase() never touches
  // Currency/CurrencyCountryMapping/CurrencySettings/PlanPrice rows
  // either, so every e2e file gets the canonical currency catalogue,
  // country mappings, and settings singleton regardless of what a
  // previous file's run left behind.
  const currencies = await seedCurrencies(prisma);
  await seedCountryMappings(prisma, currencies);
  await seedCurrencySettings(prisma, currencies);
  await seedPlanPrices(prisma, plans, currencies);

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
  await prisma.landingPageFeature.deleteMany();
  await prisma.landingPageFaq.deleteMany();
  await prisma.landingPageStat.deleteMany();
  await prisma.landingPageNavItem.deleteMany();
  await prisma.landingPageSection.deleteMany();
  await prisma.siteBranding.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.clickEvent.deleteMany();
  await prisma.linkDailyStat.deleteMany();
  await prisma.qrCode.deleteMany();
  await prisma.link.deleteMany();
  await prisma.customDomain.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.workspaceMember.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();
  if (redis) {
    await redis.flushdb();
  }
}
