/**
 * LinkIQ — Database Seed Script
 *
 * Creates:
 *   - The demo user and demo admin accounts
 *   - A starter organization + workspace for the demo user
 *   - A small set of platform feature flags
 *   - 11 realistic demo links for the demo user, spanning every lifecycle
 *     state (active, active-with-future-expiry, paused, active-but-
 *     past-expiry, archived) — no fake click counts (analytics doesn't
 *     exist yet; see Sprint 2 spec)
 *
 * NOT yet implemented (arrives with the relevant feature milestone):
 *   - QR codes, campaigns, analytics events, AI insights, tags,
 *     notifications, activity history, custom domains
 *
 * Run with: npm run prisma:seed --workspace=apps/api
 */

import {
  GlobalRole,
  LinkStatus,
  PrismaClient,
  WorkspaceRole,
} from '@prisma/client';
import type { Workspace, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const SALT_ROUNDS = 12;

async function hash(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
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

  for (const link of links) {
    await prisma.link.upsert({
      where: { shortCode: link.shortCode },
      update: {},
      create: {
        workspaceId: workspace.id,
        createdById: user.id,
        ...link,
      },
    });
  }

  console.log(`Seeded ${links.length} demo links`);
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

async function main() {
  console.log('Seeding LinkIQ database...\n');

  const { user, workspace } = await seedDemoUser();
  await seedAdminUser();
  await seedFeatureFlags();
  await seedDemoLinks(workspace, user);

  // TODO (future milestones): seed QR codes, campaigns, click analytics
  // events, AI insights, tags, notifications, activity history, and
  // custom domains for the demo account once those modules exist.
  // Deliberately NOT generating fake click counts here — see Sprint 2 spec.

  console.log('\nSeed complete.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
