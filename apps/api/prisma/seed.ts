/**
 * LinkIQ — Database Seed Script
 *
 * Foundation milestone scope:
 *   - Creates the demo user and demo admin accounts
 *   - Creates a starter organization + workspace for the demo user
 *   - Seeds a small set of platform feature flags
 *
 * NOT yet implemented (arrives with the relevant feature milestone):
 *   - Short links, QR codes, campaigns, analytics events, AI insights,
 *     tags, notifications, activity history, custom domains
 *
 * Run with: npm run prisma:seed --workspace=apps/api
 */

import { PrismaClient, GlobalRole, WorkspaceRole } from '@prisma/client';
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
    { key: 'ai_insights', description: 'AI-powered link and campaign insights', enabled: true },
    { key: 'custom_domains', description: 'Bring-your-own branded short domains', enabled: true },
    { key: 'webhooks', description: 'Outbound webhooks for link events', enabled: false },
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

  await seedDemoUser();
  await seedAdminUser();
  await seedFeatureFlags();

  // TODO (future milestones): seed short links, QR codes, campaigns,
  // analytics events, AI insights, tags, notifications, activity history,
  // and custom domains for the demo account once those modules exist.

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
