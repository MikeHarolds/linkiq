/**
 * LinkIQ — Database Seed Script
 *
 * Creates:
 *   - The demo user and demo admin accounts
 *   - A starter organization + workspace for the demo user
 *   - A small set of platform feature flags
 *   - 11 realistic demo links spanning every lifecycle state
 *   - ~30 days of realistic historical click events across those links
 *   - 6 demo QR codes across a mix of links, showing default config,
 *     custom brand colors, large/small sizes, and both PNG and SVG
 *   - 4 demo campaigns (DRAFT/ACTIVE/PAUSED/COMPLETED-via-past-end-date),
 *     retroactively associated with a subset of the already-seeded links
 *     — their existing click history rolls up into campaign analytics
 *     naturally, with no fabricated summary numbers
 *
 * All seeded analytics are internal demo data, never presented as real
 * production traffic.
 *
 * NOT yet implemented (arrives with the relevant feature milestone):
 *   - AI insights, tags, notifications, activity history, custom domains
 *
 * Run with: npm run prisma:seed --workspace=apps/api
 */

import {
  CampaignStatus,
  GlobalRole,
  LinkStatus,
  PrismaClient,
  QrErrorCorrectionLevel,
  QrFormat,
  WorkspaceRole,
} from '@prisma/client';
import type { Workspace, User, Link } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { computeVisitorHash } from '../src/modules/analytics/utils/visitor-hash';

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

async function main() {
  console.log('Seeding LinkIQ database...\n');

  const { user, workspace } = await seedDemoUser();
  await seedAdminUser();
  await seedFeatureFlags();
  const links = await seedDemoLinks(workspace, user);
  await seedDemoClickEvents(workspace, links);
  await seedDemoQrCodes(workspace, user, links);
  await seedDemoCampaigns(workspace, user, links);

  // TODO (future milestones): seed AI insights, tags, notifications,
  // activity history, and custom domains for the demo account once
  // those modules exist.

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
