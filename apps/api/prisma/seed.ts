/**
 * LinkIQ — Database Seed Script
 *
 * Creates:
 *   - 5 billing plans (Free/Starter/Professional/Business/Enterprise)
 *     with their plan-limit rows — placeholder pricing, not final
 *     commercial figures, see docs/architecture/billing.md
 *   - The demo user and demo admin accounts
 *   - A starter organization + workspace for the demo user, with an
 *     ACTIVE Professional subscription (see seedDemoSubscription for why
 *     it isn't FREE)
 *   - A small set of platform feature flags
 *   - 11 realistic demo links spanning every lifecycle state
 *   - ~30 days of realistic historical click events across those links
 *   - 6 demo QR codes across a mix of links, showing default config,
 *     custom brand colors, large/small sizes, and both PNG and SVG
 *   - 4 demo campaigns (DRAFT/ACTIVE/PAUSED/COMPLETED-via-past-end-date),
 *     retroactively associated with a subset of the already-seeded links
 *     — their existing click history rolls up into campaign analytics
 *     naturally, with no fabricated summary numbers
 *   - A FREE-plan subscription backfilled onto any pre-existing
 *     workspace that doesn't already have one (see
 *     backfillMissingSubscriptions)
 *
 * All seeded analytics are internal demo data, never presented as real
 * production traffic. No invoice/billing-history rows are seeded — see
 * docs/architecture/billing.md for why (no real payment ever occurred).
 *
 * NOT yet implemented (arrives with the relevant feature milestone):
 *   - AI insights, tags, notifications, activity history
 *
 * Run with: npm run prisma:seed --workspace=apps/api
 */

import {
  BillingInterval,
  CampaignStatus,
  GlobalRole,
  LandingPageNavPlacement,
  LandingPageSectionKey,
  LinkStatus,
  PermissionKey,
  PlanTier,
  PrismaClient,
  QrErrorCorrectionLevel,
  QrFormat,
  RoleAssignmentSource,
  SubscriptionStatus,
  WorkspaceRole,
} from '@prisma/client';
import type { Plan, PlanLimitKey, Workspace, User, Link } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { computeVisitorHash } from '../src/modules/analytics/utils/visitor-hash';
import { getEffectiveStatus, isEffectivelyOnPlan } from '../src/modules/billing/utils/effective-status';

const prisma = new PrismaClient();

const SALT_ROUNDS = 12;

async function hash(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

interface PlanSeedConfig {
  name: string;
  slug: string;
  tier: PlanTier;
  description: string;
  /** Smallest currency unit (cents) — 0 for FREE. */
  priceAmount: number;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: number | null;
  displayOrder: number;
  /** null = unlimited for that key. Placeholder figures — explicitly NOT
   * final commercial pricing, see docs/architecture/billing.md. */
  limits: Partial<Record<PlanLimitKey, number | null>>;
}

const PLAN_CONFIGS: PlanSeedConfig[] = [
  {
    name: 'Free',
    slug: 'free',
    tier: PlanTier.FREE,
    description: 'Get started with the essentials, no card required.',
    priceAmount: 0,
    currency: 'USD',
    billingInterval: BillingInterval.MONTHLY,
    trialDays: null,
    displayOrder: 0,
    limits: {
      MAX_LINKS: 25,
      MAX_QR_CODES: 10,
      MAX_CAMPAIGNS: 3,
      MAX_CUSTOM_DOMAINS: 3,
      MAX_TEAM_MEMBERS: 3,
      MONTHLY_CLICKS: 1000,
      ANALYTICS_RETENTION_DAYS: 30,
      MONTHLY_API_REQUESTS: 1_000,
      MAX_WEBHOOK_ENDPOINTS: 2,
      MONTHLY_WEBHOOK_DELIVERIES: 1_000,
    },
  },
  {
    name: 'Starter',
    slug: 'starter',
    tier: PlanTier.STARTER,
    description: 'For individuals and small projects ready to grow.',
    priceAmount: 1900,
    currency: 'USD',
    billingInterval: BillingInterval.MONTHLY,
    trialDays: 14,
    displayOrder: 1,
    limits: {
      MAX_LINKS: 500,
      MAX_QR_CODES: 100,
      MAX_CAMPAIGNS: 20,
      MAX_CUSTOM_DOMAINS: 5,
      MAX_TEAM_MEMBERS: 5,
      MONTHLY_CLICKS: 25_000,
      ANALYTICS_RETENTION_DAYS: 90,
      MONTHLY_API_REQUESTS: 10_000,
      MAX_WEBHOOK_ENDPOINTS: 5,
      MONTHLY_WEBHOOK_DELIVERIES: 25_000,
    },
  },
  {
    name: 'Professional',
    slug: 'professional',
    tier: PlanTier.PROFESSIONAL,
    description: 'For growing teams running multiple campaigns.',
    priceAmount: 4900,
    currency: 'USD',
    billingInterval: BillingInterval.MONTHLY,
    trialDays: 14,
    displayOrder: 2,
    limits: {
      MAX_LINKS: 5000,
      MAX_QR_CODES: 1000,
      MAX_CAMPAIGNS: 100,
      MAX_CUSTOM_DOMAINS: 10,
      MAX_TEAM_MEMBERS: 20,
      MONTHLY_CLICKS: 250_000,
      ANALYTICS_RETENTION_DAYS: 365,
      MONTHLY_API_REQUESTS: 100_000,
      MAX_WEBHOOK_ENDPOINTS: 20,
      MONTHLY_WEBHOOK_DELIVERIES: 250_000,
    },
  },
  {
    name: 'Business',
    slug: 'business',
    tier: PlanTier.BUSINESS,
    description: 'For larger organizations with advanced branding needs.',
    priceAmount: 14_900,
    currency: 'USD',
    billingInterval: BillingInterval.MONTHLY,
    trialDays: 14,
    displayOrder: 3,
    limits: {
      MAX_LINKS: 50_000,
      MAX_QR_CODES: 10_000,
      MAX_CAMPAIGNS: 1000,
      MAX_CUSTOM_DOMAINS: 25,
      MAX_TEAM_MEMBERS: 100,
      MONTHLY_CLICKS: 2_000_000,
      ANALYTICS_RETENTION_DAYS: 730,
      MONTHLY_API_REQUESTS: 1_000_000,
      MAX_WEBHOOK_ENDPOINTS: 100,
      MONTHLY_WEBHOOK_DELIVERIES: 2_000_000,
    },
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    tier: PlanTier.ENTERPRISE,
    description: 'Custom limits, dedicated support, and contract billing.',
    priceAmount: 0, // contract pricing — not a real "free" plan, see docs
    currency: 'USD',
    billingInterval: BillingInterval.ANNUAL,
    trialDays: null,
    displayOrder: 4,
    limits: {
      MAX_LINKS: null,
      MAX_QR_CODES: null,
      MAX_CAMPAIGNS: null,
      MAX_CUSTOM_DOMAINS: null,
      MAX_TEAM_MEMBERS: null,
      MONTHLY_CLICKS: null,
      ANALYTICS_RETENTION_DAYS: null,
      MONTHLY_API_REQUESTS: null,
      MAX_WEBHOOK_ENDPOINTS: null,
      MONTHLY_WEBHOOK_DELIVERIES: null,
    },
  },
];

/** Upserts every plan + its PlanLimit rows, idempotent across re-runs.
 * Returns a slug -> Plan map for the rest of the seed script to
 * reference (e.g. the demo workspace's Professional subscription).
 *
 * Accepts an explicit client so the e2e test suite can reuse this exact
 * seed logic against its own disposable database (see
 * test/setup-app.ts::createTestApp) without a real registration ever
 * hitting "no FREE plan configured" — defaults to this script's own
 * module-level PrismaClient for the standalone `npm run prisma:seed` path. */
export async function seedPlans(
  client: PrismaClient = prisma,
): Promise<Record<string, Plan>> {
  // Every plan is independent, and so is every limit within a plan — run
  // both waves in parallel rather than ~40 sequential round trips. This
  // keeps seedPlans() cheap enough to call unconditionally on every e2e
  // spec file's bootstrap (see test/setup-app.ts), so a PLAN_CONFIGS edit
  // (like a limit change) always takes effect immediately rather than
  // depending on whichever stale rows a previous run already committed to
  // the shared test database.
  const plans = await Promise.all(
    PLAN_CONFIGS.map((config) =>
      client.plan.upsert({
        where: { slug: config.slug },
        update: {
          name: config.name,
          tier: config.tier,
          description: config.description,
          priceAmount: config.priceAmount,
          currency: config.currency,
          billingInterval: config.billingInterval,
          trialDays: config.trialDays,
          displayOrder: config.displayOrder,
          isActive: true,
        },
        create: {
          name: config.name,
          slug: config.slug,
          tier: config.tier,
          description: config.description,
          priceAmount: config.priceAmount,
          currency: config.currency,
          billingInterval: config.billingInterval,
          trialDays: config.trialDays,
          displayOrder: config.displayOrder,
        },
      }),
    ),
  );

  const bySlug: Record<string, Plan> = {};
  await Promise.all(
    PLAN_CONFIGS.map(async (config, i) => {
      const plan = plans[i]!;
      bySlug[config.slug] = plan;
      await Promise.all(
        Object.entries(config.limits).map(([key, value]) =>
          client.planLimit.upsert({
            where: {
              planId_key: { planId: plan.id, key: key as PlanLimitKey },
            },
            update: { value: value ?? null },
            create: {
              planId: plan.id,
              key: key as PlanLimitKey,
              value: value ?? null,
            },
          }),
        ),
      );
    }),
  );

  console.log(`Seeded ${PLAN_CONFIGS.length} plans`);
  return bySlug;
}

interface RoleSeedConfig {
  name: string;
  slug: string;
  description: string;
  /** Which PLAN_CONFIGS slug this role attaches to — null for a role
   * with no corresponding purchasable plan (none today; kept optional
   * because Plan.platformRoleId itself is optional — see schema.prisma). */
  planSlug: string | null;
  permissions: PermissionKey[];
}

const FREE_PERMISSIONS: PermissionKey[] = [
  PermissionKey.LINKS_VIEW,
  PermissionKey.LINKS_CREATE,
  PermissionKey.LINKS_EDIT,
  PermissionKey.LINKS_DELETE,
  PermissionKey.ANALYTICS_VIEW,
  PermissionKey.QR_CODES_VIEW,
  PermissionKey.QR_CODES_CREATE,
  PermissionKey.QR_CODES_DELETE,
  PermissionKey.CAMPAIGNS_VIEW,
  PermissionKey.CAMPAIGNS_CREATE,
  PermissionKey.CAMPAIGNS_EDIT,
  PermissionKey.CAMPAIGNS_DELETE,
  PermissionKey.DOMAINS_VIEW,
  PermissionKey.API_VIEW,
  PermissionKey.WEBHOOKS_VIEW,
  PermissionKey.BILLING_VIEW,
];
const STARTER_PERMISSIONS: PermissionKey[] = [
  ...FREE_PERMISSIONS,
  PermissionKey.DOMAINS_CREATE,
  PermissionKey.DOMAINS_DELETE,
  PermissionKey.API_CREATE,
  PermissionKey.WEBHOOKS_CREATE,
  PermissionKey.WEBHOOKS_EDIT,
];
const PROFESSIONAL_PERMISSIONS: PermissionKey[] = [
  ...STARTER_PERMISSIONS,
  PermissionKey.API_REVOKE,
  PermissionKey.WEBHOOKS_DELETE,
  PermissionKey.ANALYTICS_ADVANCED,
];
const BUSINESS_PERMISSIONS: PermissionKey[] = [...PROFESSIONAL_PERMISSIONS, PermissionKey.BILLING_MANAGE];

/** Sprint 15 — the four system roles, each a strict permission superset
 * of the tier below it (see the *_PERMISSIONS constants above). Every
 * key here corresponds to a module that genuinely exists in LinkIQ
 * today — never invented for functionality that doesn't exist (see
 * PermissionKey's own schema docs). No ENTERPRISE_USER role: Enterprise
 * is contract-priced and not purchasable through automated checkout
 * (see PLAN_CONFIGS's own "enterprise" entry) — its Plan.platformRoleId
 * is deliberately left null rather than inventing a fifth role nobody
 * asked for. */
const ROLE_CONFIGS: RoleSeedConfig[] = [
  {
    name: 'Free User',
    slug: 'free-user',
    description: 'Default entitlement — no active paid subscription.',
    planSlug: 'free',
    permissions: FREE_PERMISSIONS,
  },
  {
    name: 'Starter User',
    slug: 'starter-user',
    description: 'Starter plan subscriber.',
    planSlug: 'starter',
    permissions: STARTER_PERMISSIONS,
  },
  {
    name: 'Professional User',
    slug: 'professional-user',
    description: 'Professional plan subscriber.',
    planSlug: 'professional',
    permissions: PROFESSIONAL_PERMISSIONS,
  },
  {
    name: 'Business User',
    slug: 'business-user',
    description: 'Business plan subscriber.',
    planSlug: 'business',
    permissions: BUSINESS_PERMISSIONS,
  },
];

/** Upserts the 4 system PlatformRoles and attaches each to its
 * corresponding Plan. Idempotent — safe to call on every e2e test
 * file's bootstrap alongside seedPlans (see test/setup-app.ts) and on
 * every `npm run prisma:seed` re-run. Permission sets are fully
 * replaced on every run (not merged) so an admin's earlier permission
 * edit to a system role plus a later seed re-run converges back to the
 * canonical set — the same "seed is the source of truth for system
 * defaults" convention seedFeatureFlags already uses. */
export async function seedPlatformRoles(
  client: PrismaClient,
  plansBySlug: Record<string, Plan>,
): Promise<Record<string, { id: string; slug: string }>> {
  const bySlug: Record<string, { id: string; slug: string }> = {};

  for (const config of ROLE_CONFIGS) {
    const role = await client.platformRole.upsert({
      where: { slug: config.slug },
      update: { name: config.name, description: config.description, isSystem: true },
      create: {
        name: config.name,
        slug: config.slug,
        description: config.description,
        isSystem: true,
      },
    });
    bySlug[config.slug] = role;

    await client.rolePermission.deleteMany({ where: { platformRoleId: role.id } });
    await client.rolePermission.createMany({
      data: config.permissions.map((permission) => ({ platformRoleId: role.id, permission })),
    });

    const plan = config.planSlug ? plansBySlug[config.planSlug] : undefined;
    if (plan) {
      await client.plan.update({ where: { id: plan.id }, data: { platformRoleId: role.id } });
    }
  }

  console.log(`Seeded ${ROLE_CONFIGS.length} platform roles`);
  return bySlug;
}

function seedTierRank(tier: PlanTier): number {
  switch (tier) {
    case PlanTier.ENTERPRISE:
      return 4;
    case PlanTier.BUSINESS:
      return 3;
    case PlanTier.PROFESSIONAL:
      return 2;
    case PlanTier.STARTER:
      return 1;
    case PlanTier.FREE:
      return 0;
    default:
      throw new Error(`Unknown plan tier: ${String(tier)}`);
  }
}

/** Sets every existing user's platformRoleId/roleAssignmentSource —
 * the seed-time equivalent of RoleResolutionService.syncStoredRole(),
 * written standalone (no Nest DI in this script, same precedent as
 * this file already importing computeVisitorHash/getEffectiveStatus as
 * plain functions rather than the services that wrap them). For every
 * user, resolves the highest-tier role among workspaces they OWN whose
 * subscription is effectively active right now, falling back to
 * free-user — see RoleResolutionService's own docs for why "highest
 * tier among owned workspaces" rather than a "primary workspace" that
 * doesn't exist anywhere in the schema. admin@linkiq.com owns no
 * workspace (seedAdminUser creates none) and therefore resolves to
 * free-user/SYSTEM_DEFAULT — harmless, since SuperAdminGuard/
 * PlatformPermissionsGuard both key off globalRole, never platformRole,
 * for a SUPER_ADMIN (see docs/architecture/roles-and-permissions.md). */
async function seedUserRoles(
  client: PrismaClient,
  rolesBySlug: Record<string, { id: string; slug: string }>,
): Promise<void> {
  const freeRole = rolesBySlug['free-user'];
  if (!freeRole) {
    throw new Error('seedUserRoles: free-user role is missing');
  }

  // Never overwrite an ADMIN_ASSIGNED override on a re-seed — Part 14 of
  // the sprint spec's "must NOT silently overwrite a manual assignment"
  // rule applies here too, not just to live subscription webhooks.
  const users = await client.user.findMany({
    where: {
      OR: [
        { roleAssignmentSource: null },
        { roleAssignmentSource: { not: RoleAssignmentSource.ADMIN_ASSIGNED } },
      ],
    },
    select: { id: true },
  });

  for (const { id: userId } of users) {
    const ownedMemberships = await client.workspaceMember.findMany({
      where: { userId, role: WorkspaceRole.OWNER },
      select: {
        workspace: {
          select: {
            subscription: {
              select: {
                status: true,
                trialEnd: true,
                cancelAt: true,
                pastDueSince: true,
                plan: { select: { tier: true, platformRoleId: true } },
              },
            },
          },
        },
      },
    });

    let bestRoleId: string | null = null;
    let bestRank = -1;
    for (const { workspace } of ownedMemberships) {
      const sub = workspace.subscription;
      if (!sub || !sub.plan.platformRoleId) continue;
      if (!isEffectivelyOnPlan(getEffectiveStatus(sub))) continue;
      const rank = seedTierRank(sub.plan.tier);
      if (rank > bestRank) {
        bestRank = rank;
        bestRoleId = sub.plan.platformRoleId;
      }
    }

    await client.user.update({
      where: { id: userId },
      data: {
        platformRoleId: bestRoleId ?? freeRole.id,
        roleAssignmentSource: bestRoleId
          ? RoleAssignmentSource.SUBSCRIPTION
          : RoleAssignmentSource.SYSTEM_DEFAULT,
      },
    });
  }

  console.log(`Resolved platform roles for ${users.length} user(s)`);
}

async function seedDemoUser() {
  const email = process.env.DEMO_USER_EMAIL ?? 'demo@linkiq.com';
  const password = process.env.DEMO_USER_PASSWORD ?? 'Demo@12345';

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: await hash(password),
      firstName: 'Demo',
      lastName: 'User',
      globalRole: GlobalRole.USER,
      emailVerified: true,
    },
  });

  const organization = await prisma.organization.upsert({
    where: { slug: 'demo-org' },
    update: {},
    create: {
      name: 'Demo Organization',
      slug: 'demo-org',
      ownerId: user.id,
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: 'main',
      },
    },
    update: {},
    create: {
      name: 'Main Workspace',
      slug: 'main',
      organizationId: organization.id,
    },
  });

  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: {
        workspaceId: workspace.id,
        userId: user.id,
      },
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      userId: user.id,
      role: WorkspaceRole.OWNER,
    },
  });

  console.log(`Seeded demo user: ${email} / ${password}`);
  return { user, organization, workspace };
}

/**
 * The demo workspace gets an ACTIVE Professional subscription rather than
 * FREE — its seeded links/QR codes/campaigns below already exceed a
 * sensible FREE tier, and a demo account showcasing a populated dashboard
 * makes more sense on a paid-tier subscription. This doesn't contradict
 * "new workspaces receive FREE" — that governs the live registration
 * path (AuthService.register / WorkspacesService.create), unaffected by
 * this seed-only override. Idempotent: leaves an existing subscription
 * alone on re-run, so manual test changes to the demo workspace's plan
 * aren't clobbered every time the seed script runs.
 */
async function seedDemoSubscription(
  workspace: Workspace,
  plans: Record<string, Plan>,
) {
  const professional = plans['professional'];
  if (!professional) {
    throw new Error('seedDemoSubscription: "professional" plan is missing');
  }

  const existing = await prisma.subscription.findUnique({
    where: { workspaceId: workspace.id },
  });
  if (existing) {
    console.log(
      'Demo workspace subscription already exists — skipping (idempotent)',
    );
    return;
  }

  const now = new Date();
  await prisma.subscription.create({
    data: {
      workspaceId: workspace.id,
      planId: professional.id,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  console.log('Seeded demo workspace subscription (Professional, ACTIVE)');
}

async function seedDemoLinks(workspace: Workspace, user: User) {
  const now = Date.now();
  const days = (n: number) => new Date(now + n * 24 * 60 * 60 * 1000);

  const links: Array<{
    shortCode: string;
    destinationUrl: string;
    title: string;
    description?: string;
    status: LinkStatus;
    isActive: boolean;
    expiresAt?: Date;
  }> = [
    {
      shortCode: 'demo-launch',
      destinationUrl: 'https://linkiq.example/blog/product-launch-2026',
      title: 'Product Launch Announcement',
      description: 'Blog post announcing the Q1 product launch.',
      status: LinkStatus.ACTIVE,
      isActive: true,
    },
    {
      shortCode: 'demo-docs',
      destinationUrl: 'https://docs.linkiq.example/getting-started',
      title: 'Getting Started Docs',
      description: 'Shared in onboarding emails.',
      status: LinkStatus.ACTIVE,
      isActive: true,
    },
    {
      shortCode: 'demo-webinar',
      destinationUrl:
        'https://linkiq.example/events/spring-webinar-registration',
      title: 'Spring Webinar Registration',
      status: LinkStatus.ACTIVE,
      isActive: true,
      expiresAt: days(14),
    },
    {
      shortCode: 'demo-pricing',
      destinationUrl: 'https://linkiq.example/pricing',
      title: 'Pricing Page',
      description: 'Used in the header nav short link for print materials.',
      status: LinkStatus.ACTIVE,
      isActive: true,
    },
    {
      shortCode: 'demo-changelog',
      destinationUrl: 'https://linkiq.example/changelog',
      title: 'Product Changelog',
      status: LinkStatus.ACTIVE,
      isActive: true,
    },
    // Paused: temporarily disabled, history preserved.
    {
      shortCode: 'demo-promo-winter',
      destinationUrl: 'https://linkiq.example/promo/winter-sale',
      title: 'Winter Sale Promo (paused)',
      description: 'Paused after the promotion period ended early.',
      status: LinkStatus.PAUSED,
      isActive: false,
    },
    {
      shortCode: 'demo-survey',
      destinationUrl: 'https://linkiq.example/survey/customer-feedback-2025',
      title: 'Customer Feedback Survey (paused)',
      status: LinkStatus.PAUSED,
      isActive: false,
    },
    // Expired: ACTIVE status, but expiresAt already passed — the redirect
    // engine derives "expired" from this, not from a stored status.
    {
      shortCode: 'demo-conf-2025',
      destinationUrl: 'https://linkiq.example/events/conf-2025-agenda',
      title: 'LinkIQ Conf 2025 Agenda',
      description: 'Event ended; link expired automatically.',
      status: LinkStatus.ACTIVE,
      isActive: true,
      expiresAt: days(-30),
    },
    {
      shortCode: 'demo-flash-sale',
      destinationUrl: 'https://linkiq.example/promo/24hr-flash-sale',
      title: '24-Hour Flash Sale',
      status: LinkStatus.ACTIVE,
      isActive: true,
      expiresAt: days(-2),
    },
    // Archived: retained for history, cannot redirect.
    {
      shortCode: 'demo-old-landing',
      destinationUrl: 'https://linkiq.example/legacy/2024-landing-page',
      title: '2024 Landing Page (archived)',
      description: 'Superseded by the current landing page.',
      status: LinkStatus.ARCHIVED,
      isActive: false,
    },
    {
      shortCode: 'demo-beta-signup',
      destinationUrl: 'https://linkiq.example/beta/signup-closed',
      title: 'Beta Signup (archived)',
      description: 'Beta program has concluded.',
      status: LinkStatus.ARCHIVED,
      isActive: false,
    },
  ];

  const seededLinks: Link[] = [];
  for (const link of links) {
    const seeded = await prisma.link.upsert({
      where: { shortCode: link.shortCode },
      update: {},
      create: {
        workspaceId: workspace.id,
        createdById: user.id,
        ...link,
      },
    });
    seededLinks.push(seeded);
  }

  console.log(`Seeded ${links.length} demo links`);
  return seededLinks;
}

interface DemoTrafficProfile {
  country: string | null;
  region: string | null;
  city: string | null;
  deviceType: string;
  os: string | null;
  browser: string | null;
  userAgent: string;
  referrerUrl: string | null;
  referrerDomain: string | null;
  referrerCategory: string;
  isBot: boolean;
  /** Relative weight — higher means this profile is picked more often,
   * approximating realistic traffic-source proportions. */
  weight: number;
}

/** A representative, hand-picked mix — not exhaustive, just enough
 * variety (per Sprint 3 spec) to make every breakdown chart in the demo
 * dashboard show something meaningful instead of a single flat bar. */
const DEMO_TRAFFIC_PROFILES: DemoTrafficProfile[] = [
  {
    country: 'US',
    region: null,
    city: null,
    deviceType: 'desktop',
    os: 'Windows',
    browser: 'Chrome',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    referrerUrl: 'https://www.google.com/search?q=linkiq',
    referrerDomain: 'google.com',
    referrerCategory: 'search',
    isBot: false,
    weight: 25,
  },
  {
    country: 'US',
    region: null,
    city: null,
    deviceType: 'mobile',
    os: 'iOS',
    browser: 'Mobile Safari',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    referrerUrl: 'https://x.com/linkiq',
    referrerDomain: 'x.com',
    referrerCategory: 'social',
    isBot: false,
    weight: 18,
  },
  {
    country: 'GB',
    region: null,
    city: null,
    deviceType: 'desktop',
    os: 'macOS',
    browser: 'Safari',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
    referrerUrl: null,
    referrerDomain: null,
    referrerCategory: 'direct',
    isBot: false,
    weight: 15,
  },
  {
    country: 'DE',
    region: null,
    city: null,
    deviceType: 'mobile',
    os: 'Android',
    browser: 'Chrome',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
    referrerUrl: 'https://www.linkedin.com/feed/',
    referrerDomain: 'linkedin.com',
    referrerCategory: 'social',
    isBot: false,
    weight: 12,
  },
  {
    country: 'CA',
    region: null,
    city: null,
    deviceType: 'desktop',
    os: 'Windows',
    browser: 'Edge',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120.0.0.0 Safari/537.36',
    referrerUrl: 'https://news.ycombinator.com/',
    referrerDomain: 'news.ycombinator.com',
    referrerCategory: 'referral',
    isBot: false,
    weight: 10,
  },
  {
    country: 'IN',
    region: null,
    city: null,
    deviceType: 'mobile',
    os: 'Android',
    browser: 'Chrome',
    userAgent:
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/119.0.0.0 Mobile Safari/537.36',
    referrerUrl: 'https://www.bing.com/search?q=linkiq',
    referrerDomain: 'bing.com',
    referrerCategory: 'search',
    isBot: false,
    weight: 8,
  },
  {
    country: 'FR',
    region: null,
    city: null,
    deviceType: 'tablet',
    os: 'iOS',
    browser: 'Mobile Safari',
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    referrerUrl: null,
    referrerDomain: null,
    referrerCategory: 'direct',
    isBot: false,
    weight: 6,
  },
  {
    country: 'AU',
    region: null,
    city: null,
    deviceType: 'desktop',
    os: 'Linux',
    browser: 'Firefox',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    referrerUrl: 'https://www.reddit.com/r/webdev/',
    referrerDomain: 'reddit.com',
    referrerCategory: 'social',
    isBot: false,
    weight: 6,
  },
  // Bot traffic — deliberately a modest slice, matching realistic crawler volume.
  {
    country: 'US',
    region: null,
    city: null,
    deviceType: 'bot',
    os: null,
    browser: null,
    userAgent:
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    referrerUrl: null,
    referrerDomain: null,
    referrerCategory: 'direct',
    isBot: true,
    weight: 5,
  },
  {
    country: 'US',
    region: null,
    city: null,
    deviceType: 'bot',
    os: null,
    browser: null,
    userAgent:
      'Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    referrerUrl: null,
    referrerDomain: null,
    referrerCategory: 'direct',
    isBot: true,
    weight: 3,
  },
];

const TOTAL_PROFILE_WEIGHT = DEMO_TRAFFIC_PROFILES.reduce(
  (sum, p) => sum + p.weight,
  0,
);

function pickWeightedProfile(): DemoTrafficProfile {
  let roll = Math.random() * TOTAL_PROFILE_WEIGHT;
  for (const profile of DEMO_TRAFFIC_PROFILES) {
    roll -= profile.weight;
    if (roll <= 0) return profile;
  }
  // DEMO_TRAFFIC_PROFILES is a non-empty literal array declared above —
  // this is only reached due to floating-point rounding at the very end
  // of the loop, never because the array is empty.
  return DEMO_TRAFFIC_PROFILES[0]!;
}

/** A small, fixed pool of synthetic IPs per profile so the same "visitor"
 * plausibly returns across days — purely for making unique-visitor counts
 * look realistic in the demo, not derived from anything real. */
const SYNTHETIC_IP_POOL = Array.from(
  { length: 40 },
  (_, i) => `203.0.113.${i + 1}`,
);

const HISTORY_DAYS = 30;
/** Skip links that clearly shouldn't have organic traffic in the demo
 * narrative — archived-from-the-start links still get a little history
 * (they had traffic before being archived), but we don't bother for every
 * link; a realistic workspace has some links that just never took off. */
function averageDailyClicksFor(shortCode: string): number {
  const highTraffic = ['demo-launch', 'demo-pricing', 'demo-webinar'];
  const mediumTraffic = [
    'demo-docs',
    'demo-changelog',
    'demo-flash-sale',
    'demo-conf-2025',
  ];
  if (highTraffic.includes(shortCode)) return 8;
  if (mediumTraffic.includes(shortCode)) return 3;
  return 1;
}

async function seedDemoClickEvents(workspace: Workspace, links: Link[]) {
  const existing = await prisma.clickEvent.count({
    where: { workspaceId: workspace.id },
  });
  if (existing > 0) {
    console.log('Demo click events already seeded — skipping (idempotent)');
    return;
  }

  const salt =
    process.env.VISITOR_HASH_SALT ?? 'linkiq-dev-salt-change-in-production';
  // Aggregated in memory first, then written as LinkDailyStat rows —
  // mirrors exactly what the real ClickEventProcessor maintains per
  // event, just computed in bulk here instead of one row at a time.
  const dailyRollups = new Map<
    string,
    { linkId: string; date: Date; total: number; human: number; bot: number }
  >();

  let totalEvents = 0;

  for (const link of links) {
    const avgDaily = averageDailyClicksFor(link.shortCode);
    if (avgDaily === 0) continue;

    for (let dayOffset = HISTORY_DAYS; dayOffset >= 0; dayOffset--) {
      // Randomize click count per day around the average, with weekends
      // slightly lower — small realistic touches, not load-bearing.
      const dayDate = new Date(Date.now() - dayOffset * 24 * 60 * 60 * 1000);
      const isWeekend = dayDate.getUTCDay() === 0 || dayDate.getUTCDay() === 6;
      const clicksToday = Math.max(
        0,
        Math.round(avgDaily * (isWeekend ? 0.6 : 1) * (0.5 + Math.random())),
      );

      const utcDay = new Date(
        Date.UTC(
          dayDate.getUTCFullYear(),
          dayDate.getUTCMonth(),
          dayDate.getUTCDate(),
        ),
      );
      const rollupKey = `${link.id}:${utcDay.toISOString()}`;

      for (let i = 0; i < clicksToday; i++) {
        const profile = pickWeightedProfile();
        const ip =
          SYNTHETIC_IP_POOL[
            Math.floor(Math.random() * SYNTHETIC_IP_POOL.length)
          ]!;
        const occurredAt = new Date(
          utcDay.getTime() + Math.floor(Math.random() * 24 * 60 * 60 * 1000),
        );
        const visitorHash = computeVisitorHash(
          ip,
          profile.userAgent,
          occurredAt,
          salt,
        );

        await prisma.clickEvent.create({
          data: {
            linkId: link.id,
            workspaceId: workspace.id,
            occurredAt,
            visitorHash,
            country: profile.country,
            region: profile.region,
            city: profile.city,
            deviceType: profile.deviceType,
            os: profile.os,
            browser: profile.browser,
            userAgent: profile.userAgent,
            referrerUrl: profile.referrerUrl,
            referrerDomain: profile.referrerDomain,
            referrerCategory: profile.referrerCategory,
            isBot: profile.isBot,
          },
        });
        totalEvents++;

        const rollup = dailyRollups.get(rollupKey) ?? {
          linkId: link.id,
          date: utcDay,
          total: 0,
          human: 0,
          bot: 0,
        };
        rollup.total += 1;
        if (profile.isBot) rollup.bot += 1;
        else rollup.human += 1;
        dailyRollups.set(rollupKey, rollup);
      }
    }
  }

  for (const rollup of dailyRollups.values()) {
    await prisma.linkDailyStat.upsert({
      where: { linkId_date: { linkId: rollup.linkId, date: rollup.date } },
      update: {
        totalClicks: rollup.total,
        humanClicks: rollup.human,
        botClicks: rollup.bot,
      },
      create: {
        linkId: rollup.linkId,
        workspaceId: workspace.id,
        date: rollup.date,
        totalClicks: rollup.total,
        humanClicks: rollup.human,
        botClicks: rollup.bot,
      },
    });
  }

  console.log(
    `Seeded ${totalEvents} demo click events across ${HISTORY_DAYS + 1} days (internal demo data — not real production traffic)`,
  );
}

function findLink(links: Link[], shortCode: string): Link {
  const link = links.find((l) => l.shortCode === shortCode);
  if (!link) {
    throw new Error(
      `seedDemoQrCodes: expected a seeded link with shortCode "${shortCode}"`,
    );
  }
  return link;
}

async function seedDemoQrCodes(
  workspace: Workspace,
  user: User,
  links: Link[],
) {
  const existing = await prisma.qrCode.count({
    where: { workspaceId: workspace.id },
  });
  if (existing > 0) {
    console.log('Demo QR codes already seeded — skipping (idempotent)');
    return;
  }

  const qrCodes: Array<{
    linkShortCode: string;
    name: string;
    format: QrFormat;
    size?: number;
    foregroundColor?: string;
    backgroundColor?: string;
    errorCorrectionLevel?: QrErrorCorrectionLevel;
    margin?: number;
  }> = [
    // Default QR — every option left at its schema default.
    {
      linkShortCode: 'demo-launch',
      name: 'Product Launch — Default',
      format: QrFormat.PNG,
    },
    // Custom brand colors.
    {
      linkShortCode: 'demo-launch',
      name: 'Product Launch — Brand Colors',
      format: QrFormat.PNG,
      foregroundColor: '#1d4ed8',
      backgroundColor: '#eff6ff',
      errorCorrectionLevel: QrErrorCorrectionLevel.H,
    },
    // Larger size, for print materials.
    {
      linkShortCode: 'demo-pricing',
      name: 'Pricing Page — Print Poster (Large)',
      format: QrFormat.PNG,
      size: 1024,
      margin: 6,
    },
    // Small size, for a business card or similar.
    {
      linkShortCode: 'demo-pricing',
      name: 'Pricing Page — Business Card (Small)',
      format: QrFormat.PNG,
      size: 160,
      margin: 1,
    },
    // SVG example — scalable, for design tools / vector print workflows.
    {
      linkShortCode: 'demo-webinar',
      name: 'Spring Webinar — SVG for Print Vendor',
      format: QrFormat.SVG,
      foregroundColor: '#111827',
      backgroundColor: '#f9fafb',
    },
    // Another custom-color example on a different link, high error
    // correction (common for QR codes that may get partially obscured,
    // e.g. a logo overlay in a design tool — LinkIQ doesn't composite a
    // logo itself, but H correction leaves headroom for one added later).
    {
      linkShortCode: 'demo-docs',
      name: 'Docs — Onboarding Email',
      format: QrFormat.PNG,
      foregroundColor: '#065f46',
      backgroundColor: '#ffffff',
      errorCorrectionLevel: QrErrorCorrectionLevel.H,
    },
  ];

  for (const qr of qrCodes) {
    const link = findLink(links, qr.linkShortCode);
    await prisma.qrCode.create({
      data: {
        workspaceId: workspace.id,
        linkId: link.id,
        createdById: user.id,
        name: qr.name,
        format: qr.format,
        size: qr.size,
        foregroundColor: qr.foregroundColor,
        backgroundColor: qr.backgroundColor,
        errorCorrectionLevel: qr.errorCorrectionLevel,
        margin: qr.margin,
      },
    });
  }

  console.log(`Seeded ${qrCodes.length} demo QR codes`);
}

async function seedAdminUser() {
  const email = process.env.DEMO_ADMIN_EMAIL ?? 'admin@linkiq.com';
  const password = process.env.DEMO_ADMIN_PASSWORD ?? 'Admin@12345';

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: await hash(password),
      firstName: 'Platform',
      lastName: 'Admin',
      globalRole: GlobalRole.SUPER_ADMIN,
      emailVerified: true,
    },
  });

  console.log(`Seeded admin user: ${email} / ${password}`);
  return admin;
}

async function seedDemoCampaigns(
  workspace: Workspace,
  user: User,
  links: Link[],
) {
  const existing = await prisma.campaign.count({
    where: { workspaceId: workspace.id },
  });
  if (existing > 0) {
    console.log('Demo campaigns already seeded — skipping (idempotent)');
    return;
  }

  const byShortCode = new Map(links.map((link) => [link.shortCode, link]));
  const now = Date.now();
  const days = (n: number) => new Date(now + n * 24 * 60 * 60 * 1000);

  const campaignConfigs: Array<{
    name: string;
    description: string;
    status: CampaignStatus;
    startDate?: Date;
    endDate?: Date;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    linkShortCodes: string[];
  }> = [
    {
      name: '2026 Summer Campaign',
      description:
        'Cross-channel push for the July sale — social, email, and print.',
      status: CampaignStatus.ACTIVE,
      startDate: days(-14),
      endDate: days(30),
      utmSource: 'newsletter',
      utmMedium: 'email',
      utmCampaign: 'summer_campaign_2026',
      // Retroactively associates these already-seeded, already-clicked
      // links with the campaign — their existing ClickEvent history
      // rolls up into campaign analytics naturally, with no fabricated
      // summary numbers (Sprint 5 spec, "Demo Data").
      linkShortCodes: ['demo-flash-sale', 'demo-pricing'],
    },
    {
      name: 'Product Launch Campaign',
      description: 'Launch-day push for the new release across every channel.',
      status: CampaignStatus.ACTIVE,
      startDate: days(-7),
      utmSource: 'twitter',
      utmMedium: 'social',
      utmCampaign: 'product_launch_2026',
      linkShortCodes: ['demo-launch', 'demo-changelog'],
    },
    {
      name: 'Social Media Campaign',
      description: 'Ongoing organic + paid social promotion.',
      status: CampaignStatus.PAUSED,
      startDate: days(-30),
      utmSource: 'facebook',
      utmMedium: 'social',
      utmCampaign: 'social_always_on',
      linkShortCodes: ['demo-webinar'],
    },
    {
      name: 'QR Promotion Campaign',
      description:
        'In-store and print QR codes driving traffic to the docs handout and pricing page.',
      status: CampaignStatus.COMPLETED,
      startDate: days(-60),
      endDate: days(-1), // already ended — reported as COMPLETED via the derived-status rule
      utmSource: 'qr_code',
      utmMedium: 'qr',
      utmCampaign: 'qr_promotion_2026',
      linkShortCodes: ['demo-docs'],
    },
  ];

  let seededCampaigns = 0;
  let associatedLinks = 0;

  for (const config of campaignConfigs) {
    const campaign = await prisma.campaign.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: config.name,
        description: config.description,
        status: config.status,
        startDate: config.startDate,
        endDate: config.endDate,
        utmSource: config.utmSource,
        utmMedium: config.utmMedium,
        utmCampaign: config.utmCampaign,
      },
    });
    seededCampaigns++;

    for (const shortCode of config.linkShortCodes) {
      const link = byShortCode.get(shortCode);
      if (!link) continue; // defensive: skip silently if demo links ever change shape

      await prisma.link.update({
        where: { id: link.id },
        data: {
          campaignId: campaign.id,
          // The link inherits the campaign's UTM defaults here, exactly
          // as LinksService.resolveUtmFields would for a real user
          // assigning a link to a campaign — not a special seed-only path.
          utmSource: config.utmSource,
          utmMedium: config.utmMedium,
          utmCampaign: config.utmCampaign,
        },
      });
      associatedLinks++;
    }
  }

  console.log(
    `Seeded ${seededCampaigns} demo campaigns, associated with ${associatedLinks} existing links (internal demo data)`,
  );
}

async function seedFeatureFlags() {
  const flags = [
    {
      key: 'ai_insights',
      description: 'AI-powered link and campaign insights',
      enabled: true,
    },
    {
      key: 'custom_domains',
      description: 'Bring-your-own branded short domains',
      enabled: true,
    },
    {
      key: 'webhooks',
      description: 'Outbound webhooks for link events',
      enabled: false,
    },
  ];

  for (const flag of flags) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: {},
      create: flag,
    });
  }

  console.log(`Seeded ${flags.length} feature flags`);
}

/**
 * Sprint 14 — reproduces the exact Sprint 12 landing page copy as
 * real, admin-editable database rows, so the public site looks
 * identical the moment this seed runs, with no manual data-entry step
 * required after deployment (see docs/architecture/landing-page-cms.md).
 * Idempotent: sections are upserted by their unique `key`; the
 * repeatable lists (features/faqs/stats/nav items) are skipped
 * entirely if any rows already exist, the same "don't re-seed once
 * real content might have been edited" convention seedDemoClickEvents
 * already uses.
 */
async function seedLandingPageContent() {
  const sections: Array<{
    key: LandingPageSectionKey;
    eyebrow?: string;
    headline?: string;
    description?: string;
    primaryCtaText?: string;
    primaryCtaUrl?: string;
    secondaryCtaText?: string;
    secondaryCtaUrl?: string;
  }> = [
    {
      key: LandingPageSectionKey.HERO,
      eyebrow: 'Link intelligence platform',
      headline: 'Every link tells a story.',
      description:
        'LinkIQ shows you what happens after the click — who clicked, where they went, and what to do next. Short links, custom domains, and analytics built as one system, not three bolted-together tools.',
      primaryCtaText: 'Get started for free',
      primaryCtaUrl: '/register',
      secondaryCtaText: 'View pricing',
      secondaryCtaUrl: '#pricing',
    },
    { key: LandingPageSectionKey.STATS },
    {
      key: LandingPageSectionKey.FEATURES,
      eyebrow: 'The core loop',
      headline: 'Everything a link needs to do its job',
      description: 'From the moment you shorten it to the moment someone acts on it.',
    },
    {
      key: LandingPageSectionKey.PRODUCT_SHOWCASE,
      eyebrow: 'See it in action',
      headline: 'Every click, the moment it happens',
      description:
        'This is the same analytics workspace every LinkIQ link reports into — who clicked, where they came from, and which links are actually working.',
    },
    {
      key: LandingPageSectionKey.CUSTOM_DOMAINS,
      eyebrow: 'Custom domains',
      headline: 'Your links. Your brand.',
      description:
        'A link that says go.yourbrand.com earns more trust — and more clicks — than one that says linkiq.io. Connect your domain once; every link you create after that inherits it.',
    },
    {
      key: LandingPageSectionKey.DEVELOPERS,
      eyebrow: 'For developers',
      headline: 'Built to be automated, not just clicked through.',
      description:
        'Create and manage links from your own systems with a scoped API key, and react to activity in real time with webhook events — no dashboard required.',
      primaryCtaText: 'Get an API key',
      primaryCtaUrl: '/register',
    },
    {
      key: LandingPageSectionKey.PRICING,
      eyebrow: 'Simple, transparent pricing',
      headline: 'Choose the plan that grows with you',
    },
    {
      key: LandingPageSectionKey.FAQ,
      eyebrow: 'Questions',
      headline: 'Frequently asked questions',
    },
    {
      key: LandingPageSectionKey.CTA,
      headline: 'Start seeing what happens after the click.',
      description: 'Free forever plan. No credit card required.',
      primaryCtaText: 'Get started for free',
      primaryCtaUrl: '/register',
    },
  ];

  for (const section of sections) {
    await prisma.landingPageSection.upsert({
      where: { key: section.key },
      update: {},
      create: section,
    });
  }

  const existingFeatures = await prisma.landingPageFeature.count();
  if (existingFeatures === 0) {
    await prisma.landingPageFeature.createMany({
      data: [
        { title: 'Shorten', description: 'Turn any URL into a clean, brandable link in milliseconds.', icon: 'Link2', sortOrder: 0 },
        { title: 'Track', description: 'See clicks, visitors, and sources the moment they happen.', icon: 'BarChart3', sortOrder: 1 },
        { title: 'Brand', description: 'Route every link through a domain your audience recognizes.', icon: 'Globe2', sortOrder: 2 },
        { title: 'Automate', description: 'Create links and react to activity from your own systems.', icon: 'Webhook', sortOrder: 3 },
        { title: 'Scale', description: 'Workspaces, roles, and permissions built for real teams.', icon: 'Users', sortOrder: 4 },
      ],
    });
  }

  const existingStats = await prisma.landingPageStat.count();
  if (existingStats === 0) {
    await prisma.landingPageStat.createMany({
      data: [
        { label: 'Fast redirects', sublabel: 'Cached, low-latency', icon: 'Zap', sortOrder: 0 },
        { label: 'Secure by design', sublabel: 'Scoped API keys & RBAC', icon: 'ShieldCheck', sortOrder: 1 },
        { label: 'Custom domains', sublabel: 'Every link, on-brand', icon: 'Globe2', sortOrder: 2 },
        { label: 'Team workspaces', sublabel: 'Role-based collaboration', icon: 'Users', sortOrder: 3 },
        { label: 'Developer API', sublabel: 'REST + webhooks', icon: 'Terminal', sortOrder: 4 },
      ],
    });
  }

  const existingFaqs = await prisma.landingPageFaq.count();
  if (existingFaqs === 0) {
    await prisma.landingPageFaq.createMany({
      data: [
        {
          question: 'What is LinkIQ?',
          answer:
            'LinkIQ is a link management platform for modern teams — shorten and share links, brand them with your own domain, track clicks in real time, and automate link creation through an API.',
          sortOrder: 0,
        },
        {
          question: 'Can I use my own domain?',
          answer:
            'Yes. Connect a custom domain to your workspace, verify ownership with a DNS record, and every link you create can use your branded domain instead of a generic shortener host.',
          sortOrder: 1,
        },
        {
          question: 'Can I track clicks?',
          answer:
            'Yes. Every link reports real-time analytics — total clicks, devices, countries, and referrers — broken down per link and per campaign so you can see exactly what is driving traffic.',
          sortOrder: 2,
        },
        {
          question: 'Does LinkIQ have an API?',
          answer:
            'Yes. LinkIQ ships a REST API secured with scoped API keys, so you can create and manage links programmatically and subscribe to webhook events for real-time notifications.',
          sortOrder: 3,
        },
        {
          question: 'Can teams collaborate?',
          answer:
            'Yes. Every workspace supports role-based access for your team — owners, admins, members, and viewers — so you can collaborate on links and campaigns with the right level of access for each person.',
          sortOrder: 4,
        },
        {
          question: 'How does billing work?',
          answer:
            'LinkIQ offers a free plan plus paid plans that scale with usage — links, clicks, domains, and team seats. Paid plans include a trial period, and you can change plans at any time from your workspace billing settings.',
          sortOrder: 5,
        },
      ],
    });
  }

  const existingNavItems = await prisma.landingPageNavItem.count();
  if (existingNavItems === 0) {
    await prisma.landingPageNavItem.createMany({
      data: [
        { placement: LandingPageNavPlacement.HEADER, label: 'Product', url: '/#features', sortOrder: 0 },
        { placement: LandingPageNavPlacement.HEADER, label: 'Pricing', url: '/#pricing', sortOrder: 1 },
        { placement: LandingPageNavPlacement.HEADER, label: 'Developers', url: '/#developers', sortOrder: 2 },
        { placement: LandingPageNavPlacement.FOOTER_PRODUCT, label: 'Link Management', url: '/#features', sortOrder: 0 },
        { placement: LandingPageNavPlacement.FOOTER_PRODUCT, label: 'Analytics', url: '/#features', sortOrder: 1 },
        { placement: LandingPageNavPlacement.FOOTER_PRODUCT, label: 'Custom Domains', url: '/#features', sortOrder: 2 },
        { placement: LandingPageNavPlacement.FOOTER_PRODUCT, label: 'QR Codes', url: '/#features', sortOrder: 3 },
        { placement: LandingPageNavPlacement.FOOTER_PRODUCT, label: 'Campaigns', url: '/#features', sortOrder: 4 },
        { placement: LandingPageNavPlacement.FOOTER_DEVELOPERS, label: 'API', url: '/#developers', sortOrder: 0 },
        { placement: LandingPageNavPlacement.FOOTER_DEVELOPERS, label: 'Webhooks', url: '/#developers', sortOrder: 1 },
        { placement: LandingPageNavPlacement.FOOTER_COMPANY, label: 'Contact', url: 'mailto:support@linkiq.com', sortOrder: 0 },
      ],
    });
  }

  // Singleton row — same fixed id BrandingService always targets (see
  // its own docs on why a singleton is enforced in application logic).
  await prisma.siteBranding.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: { id: '00000000-0000-0000-0000-000000000001', siteName: 'LinkIQ' },
  });

  console.log('Seeded landing page content (sections, features, FAQs, stats, nav items) and site branding');
}

/**
 * Every workspace created through the live app (AuthService.register,
 * WorkspacesService.create) gets a subscription transactionally and can
 * never be missing one — this covers workspaces that already existed in
 * a local dev database from before Sprint 7, which never went through
 * that path. Idempotent and safe to re-run; BillingUsageService also
 * tolerates a missing subscription gracefully regardless (falls back to
 * FREE), so this is belt-and-braces, not load-bearing.
 */
async function backfillMissingSubscriptions(plans: Record<string, Plan>) {
  const free = plans['free'];
  if (!free) {
    throw new Error('backfillMissingSubscriptions: "free" plan is missing');
  }

  const orphaned = await prisma.workspace.findMany({
    where: { subscription: null },
    select: { id: true },
  });

  for (const workspace of orphaned) {
    await prisma.subscription.create({
      data: {
        workspaceId: workspace.id,
        planId: free.id,
        status: SubscriptionStatus.ACTIVE,
      },
    });
  }

  if (orphaned.length > 0) {
    console.log(
      `Backfilled FREE subscriptions for ${orphaned.length} pre-existing workspace(s)`,
    );
  }
}

async function main() {
  console.log('Seeding LinkIQ database...\n');

  const plans = await seedPlans();
  const roles = await seedPlatformRoles(prisma, plans);
  const { user, workspace } = await seedDemoUser();
  await seedDemoSubscription(workspace, plans);
  await seedAdminUser();
  await seedFeatureFlags();
  await seedLandingPageContent();
  const links = await seedDemoLinks(workspace, user);
  await seedDemoClickEvents(workspace, links);
  await seedDemoQrCodes(workspace, user, links);
  await seedDemoCampaigns(workspace, user, links);
  await backfillMissingSubscriptions(plans);
  await seedUserRoles(prisma, roles);

  // TODO (future milestones): seed AI insights, tags, notifications,
  // activity history, and custom domains for the demo account once
  // those modules exist.

  console.log('\nSeed complete.');
}

// Only run the full demo seed when this file is executed directly (`npm
// run prisma:seed`) — the e2e test suite imports `seedPlans` from this
// module without wanting the demo user/links/campaigns/etc. seeded too.
if (require.main === module) {
  main()
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
