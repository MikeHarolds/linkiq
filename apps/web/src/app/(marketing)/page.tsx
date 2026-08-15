import { Badge, Button, Card } from '@linkiq/ui';
import {
  ArrowRight,
  BarChart3,
  Globe2,
  Key,
  MousePointerClick,
  ShieldCheck,
  Terminal,
  Users,
  Webhook,
} from 'lucide-react';
import Link from 'next/link';
import type { ComponentProps } from 'react';

import { CtaSection } from '@/components/marketing/cta-section';
import { FaqSection } from '@/components/marketing/faq-section';
import { FeatureGrid } from '@/components/marketing/feature-grid';
import { HeroSection } from '@/components/marketing/hero-section';
import { PricingCard } from '@/components/marketing/pricing-card';
import { StatStrip } from '@/components/marketing/stat-strip';

// Real, already-shipped metrics this preview reuses (see
// components/marketing/hero-section.tsx and the actual dashboard's
// analytics — the same categories: clicks, visitors, countries,
// devices, referrers, top links). Static and illustrative, not a live
// feed, and labeled as such.
const CLICK_TREND = [28, 34, 22, 40, 52, 38, 61, 48, 70, 55, 82, 66, 90, 74];

const SHOWCASE_STATS = [
  { label: 'Clicks', value: '28.4K', icon: MousePointerClick },
  { label: 'Visitors', value: '9.7K', icon: Users },
  { label: 'Countries', value: '24', icon: Globe2 },
  { label: 'Devices', value: '3 types', icon: BarChart3 },
] as const;

const TOP_LINKS = [
  { code: 'go.acme.com/summer26', clicks: '4,821' },
  { code: 'go.acme.com/launch-day', clicks: '3,209' },
  { code: 'go.acme.com/webinar-q3', clicks: '1,984' },
];

const REFERRERS = [
  { source: 'Social', pct: 42 },
  { source: 'Search', pct: 24 },
  { source: 'Direct', pct: 18 },
  { source: 'Referral', pct: 10 },
];

const PRICING_TIERS: Array<
  ComponentProps<typeof PricingCard> & { key: string }
> = [
  {
    key: 'free',
    name: 'Free',
    price: '$0',
    description: 'Get started with the essentials, no card required.',
    features: [
      '25 links',
      '1,000 clicks / month',
      '3 custom domains',
      '3 team members',
    ],
    ctaLabel: 'Start for free',
    href: '/register',
  },
  {
    key: 'starter',
    name: 'Starter',
    price: '$19',
    priceSuffix: '/mo',
    description: 'For individuals and small projects ready to grow.',
    features: [
      '500 links',
      '25,000 clicks / month',
      '5 custom domains',
      '14-day free trial',
    ],
    ctaLabel: 'Start for free',
    href: '/register',
  },
  {
    key: 'professional',
    name: 'Professional',
    price: '$49',
    priceSuffix: '/mo',
    description: 'For growing teams running multiple campaigns.',
    features: [
      '5,000 links',
      '250,000 clicks / month',
      '10 custom domains',
      '20 team members',
    ],
    ctaLabel: 'Start for free',
    href: '/register',
    highlighted: true,
  },
  {
    key: 'business',
    name: 'Business',
    price: '$149',
    priceSuffix: '/mo',
    description: 'For larger organizations with advanced branding needs.',
    features: [
      '50,000 links',
      '2,000,000 clicks / month',
      '25 custom domains',
      '100 team members',
    ],
    ctaLabel: 'Start for free',
    href: '/register',
  },
];

function ProductShowcaseSection() {
  const maxTrend = Math.max(...CLICK_TREND);

  return (
    <section
      id="product"
      className="relative border-t border-white/10 bg-muted py-24 sm:py-32"
    >
      <div
        aria-hidden="true"
        className="bg-grid-dots pointer-events-none absolute inset-0 opacity-[0.08]"
      />
      <div className="container relative">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-xs font-semibold uppercase tracking-wide text-primary">
            See it in action
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Every click, the moment it happens
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            This is the same analytics workspace every LinkIQ link reports into
            — who clicked, where they came from, and which links are actually
            working.
          </p>
        </div>

        <Card className="mx-auto mt-14 max-w-4xl overflow-hidden border-white/10 bg-card p-0 shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
            <div className="flex items-center gap-2">
              <span
                className="animate-signal-pulse h-1.5 w-1.5 rounded-full bg-emerald-400"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Analytics overview
                </p>
                <p className="text-xs text-muted-foreground">
                  Illustrative product preview
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className="border-white/10 bg-white/5 text-xs text-muted-foreground"
            >
              Last 30 days
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-px border-b border-white/10 bg-white/5 sm:grid-cols-4">
            {SHOWCASE_STATS.map((stat) => (
              <div
                key={stat.label}
                className="flex items-center gap-2.5 bg-card px-4 py-3"
              >
                <stat.icon
                  className="h-4 w-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-semibold tabular-nums text-foreground">
                    {stat.value}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {stat.label}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-6 p-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Clicks over time
              </p>
              <div
                className="flex h-32 items-end gap-1.5"
                role="img"
                aria-label="Illustrative chart of clicks trending upward over the last 30 days"
              >
                {CLICK_TREND.map((value, index) => (
                  <div
                    key={index}
                    className="flex-1 rounded-t-sm bg-gradient-to-t from-primary/60 to-primary/15"
                    style={{ height: `${(value / maxTrend) * 100}%` }}
                  />
                ))}
              </div>

              <p className="mb-3 mt-6 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Top links
              </p>
              <ul className="space-y-2">
                {TOP_LINKS.map((link) => (
                  <li
                    key={link.code}
                    className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
                  >
                    <span className="font-mono font-medium text-primary">
                      {link.code}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {link.clicks} clicks
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-2">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Referrers
              </p>
              <ul className="space-y-3">
                {REFERRERS.map((entry) => (
                  <li key={entry.source}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-foreground">{entry.source}</span>
                      <span className="text-muted-foreground">
                        {entry.pct}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-white/10">
                      <div
                        className="h-1.5 rounded-full bg-primary"
                        style={{ width: `${entry.pct}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}

function CustomDomainsSection() {
  return (
    <section className="border-t border-white/10 bg-background py-24 sm:py-32">
      <div className="container grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-wide text-primary">
            Custom domains
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Your links.
            <br />
            Your brand.
          </h2>
          <p className="mt-4 max-w-md text-muted-foreground">
            A link that says go.yourbrand.com earns more trust — and more clicks
            — than one that says linkiq.io. Connect your domain once; every link
            you create after that inherits it.
          </p>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-card p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Default
            </p>
            <p className="mt-2 font-mono text-lg text-muted-foreground">
              linkiq.io/a8Kx92
            </p>
          </div>
          <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-primary/10 p-5">
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs font-medium uppercase tracking-wide text-dash-highlight">
                Branded
              </p>
              <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-emerald-400">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                DNS verified
              </span>
            </div>
            <p className="mt-2 font-mono text-lg font-medium text-dash-highlight">
              go.yourbrand.com/summer
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function DeveloperSection() {
  return (
    <section
      id="developers"
      className="border-t border-white/10 bg-muted py-24 sm:py-32"
    >
      <div className="container grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-wide text-primary">
            For developers
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Built to be automated,
            <br />
            not just clicked through.
          </h2>
          <p className="mt-4 max-w-md text-muted-foreground">
            Create and manage links from your own systems with a scoped API key,
            and react to activity in real time with webhook events — no
            dashboard required.
          </p>
          <ul className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <li className="flex items-center gap-2 text-foreground">
              <Terminal className="h-4 w-4 text-primary" aria-hidden="true" />
              REST API
            </li>
            <li className="flex items-center gap-2 text-foreground">
              <Key className="h-4 w-4 text-primary" aria-hidden="true" />
              Scoped API keys
            </li>
            <li className="flex items-center gap-2 text-foreground">
              <Webhook className="h-4 w-4 text-primary" aria-hidden="true" />
              Webhooks
            </li>
            <li className="flex items-center gap-2 text-foreground">
              <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />
              Analytics API
            </li>
          </ul>
          <Button asChild variant="link" className="mt-4 h-auto p-0">
            <Link href="/register">
              Get an API key
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>

        {/* Same terminal-panel vocabulary as the dashboard's Developers
            page (deep-dark fixed surface, traffic-light dots, orange
            comment-style accents) — deliberately reused, not
            reinvented, so the two surfaces read as one product. */}
        <div className="overflow-hidden rounded-xl border border-white/10 bg-[#05080D] text-left shadow-2xl">
          <div className="flex items-center gap-1.5 border-b border-white/10 bg-white/[0.03] px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="ml-2 font-mono text-xs text-[#94A3B8]">
              create-link.sh
            </span>
          </div>
          <pre className="overflow-x-auto p-5 text-sm leading-relaxed">
            <code className="text-[#F8FAFC]">
              <span className="text-[#94A3B8]">
                # Authenticate with a scoped key
              </span>
              {'\n'}curl https://api.linkiq.io/v1/links \{'\n'}
              {'  '}
              <span className="text-[#FF8A3D]">-H</span> &quot;Authorization:
              Bearer lk_live_••••3f2a&quot; \{'\n'}
              {'  '}
              <span className="text-[#FF8A3D]">-d</span> {'{'}{' '}
              &quot;destinationUrl&quot;: &quot;https://acme.com/sale&quot;{' '}
              {'}'}
            </code>
          </pre>
          <div className="border-t border-white/10 px-5 py-4">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-[#94A3B8]">
              # Response 201
            </p>
            <pre className="overflow-x-auto text-sm leading-relaxed">
              <code className="text-[#F8FAFC]">
                {'{ '}
                <span className="text-[#FF8A3D]">&quot;shortUrl&quot;</span>:
                &quot;go.acme.com/x7K2p&quot;,{' '}
                <span className="text-[#FF8A3D]">&quot;status&quot;</span>:
                &quot;ACTIVE&quot;
                {' }'}
              </code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section
      id="pricing"
      className="border-t border-white/10 bg-background py-24 sm:py-32"
    >
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-xs font-semibold uppercase tracking-wide text-primary">
            Simple, transparent pricing
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Choose the plan that grows with you
          </h2>
        </div>

        <div className="mx-auto mt-14 grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PRICING_TIERS.map(({ key, ...tier }) => (
            <PricingCard key={key} {...tier} />
          ))}
        </div>

        <div className="mx-auto mt-6 flex max-w-6xl flex-col items-center justify-between gap-3 rounded-xl border border-white/10 bg-card p-6 sm:flex-row">
          <div>
            <p className="text-sm font-semibold text-foreground">Enterprise</p>
            <p className="text-sm text-muted-foreground">
              Custom limits, dedicated support, and contract billing for larger
              organizations.
            </p>
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <Link href="/register">Contact sales</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <>
      <HeroSection />
      <StatStrip />
      <FeatureGrid />
      <ProductShowcaseSection />
      <CustomDomainsSection />
      <DeveloperSection />
      <PricingSection />
      <FaqSection />
      <CtaSection />
    </>
  );
}
