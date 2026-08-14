import { Badge, Button, Card } from '@linkiq/ui';
import { Key, Terminal, Webhook, BarChart3, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ComponentProps } from 'react';

import { CtaSection } from '@/components/marketing/cta-section';
import { FaqSection } from '@/components/marketing/faq-section';
import { FeatureGrid } from '@/components/marketing/feature-grid';
import { HeroSection } from '@/components/marketing/hero-section';
import { PricingCard } from '@/components/marketing/pricing-card';
import { StatStrip } from '@/components/marketing/stat-strip';

const CLICK_TREND = [28, 34, 22, 40, 52, 38, 61, 48, 70, 55, 82, 66, 90, 74];

const TOP_LINKS = [
  { code: 'linkiq.io/summer26', clicks: '4,821' },
  { code: 'linkiq.io/launch-day', clicks: '3,209' },
  { code: 'linkiq.io/webinar-q3', clicks: '1,984' },
];

const TOP_COUNTRIES = [
  { country: 'United States', pct: 42 },
  { country: 'United Kingdom', pct: 21 },
  { country: 'Germany', pct: 14 },
  { country: 'Nigeria', pct: 9 },
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
    <section id="product" className="border-t bg-muted/30 py-24 sm:py-32">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            See your links the moment they perform
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            A preview of the analytics workspace every LinkIQ link reports into
            — clicks over time, top links, and where your audience is coming
            from.
          </p>
        </div>

        <Card className="mx-auto mt-14 max-w-4xl overflow-hidden border-border/80 p-0 shadow-lg">
          <div className="flex items-center justify-between border-b bg-background px-6 py-4">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Analytics overview
              </p>
              <p className="text-xs text-muted-foreground">
                Illustrative product preview
              </p>
            </div>
            <Badge variant="secondary" className="text-xs">
              Last 30 days
            </Badge>
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
                    className="flex-1 rounded-t-sm bg-orange-200 dark:bg-orange-500/25"
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
                    className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-foreground">
                      {link.code}
                    </span>
                    <span className="text-muted-foreground">
                      {link.clicks} clicks
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-2">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Top countries
              </p>
              <ul className="space-y-3">
                {TOP_COUNTRIES.map((entry) => (
                  <li key={entry.country}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-foreground">{entry.country}</span>
                      <span className="text-muted-foreground">
                        {entry.pct}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted">
                      <div
                        className="h-1.5 rounded-full bg-orange-500"
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
    <section className="border-t bg-background py-24 sm:py-32">
      <div className="container grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-orange-600 dark:text-orange-400">
            Custom domains
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Your links.
            <br />
            Your brand.
          </h2>
          <p className="mt-4 max-w-md text-muted-foreground">
            Connect your own domain and make every shared link feel like part of
            your brand, not a third-party redirect.
          </p>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border bg-muted/30 p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Default
            </p>
            <p className="mt-2 font-mono text-lg text-muted-foreground">
              linkiq.io/a8Kx92
            </p>
          </div>
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-5 dark:border-orange-500/30 dark:bg-orange-500/10">
            <p className="text-xs font-medium uppercase tracking-wide text-orange-700 dark:text-orange-300">
              Branded
            </p>
            <p className="mt-2 font-mono text-lg font-medium text-orange-700 dark:text-orange-300">
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
    <section id="developers" className="border-t bg-muted/30 py-24 sm:py-32">
      <div className="container grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Built for developers.
            <br />
            Ready for automation.
          </h2>
          <p className="mt-4 max-w-md text-muted-foreground">
            Create and manage links programmatically with a scoped API key, and
            react to activity in real time with webhook events.
          </p>
          <ul className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <li className="flex items-center gap-2 text-foreground">
              <Terminal
                className="h-4 w-4 text-orange-600 dark:text-orange-400"
                aria-hidden="true"
              />
              REST API
            </li>
            <li className="flex items-center gap-2 text-foreground">
              <Key
                className="h-4 w-4 text-orange-600 dark:text-orange-400"
                aria-hidden="true"
              />
              API keys
            </li>
            <li className="flex items-center gap-2 text-foreground">
              <Webhook
                className="h-4 w-4 text-orange-600 dark:text-orange-400"
                aria-hidden="true"
              />
              Webhooks
            </li>
            <li className="flex items-center gap-2 text-foreground">
              <BarChart3
                className="h-4 w-4 text-orange-600 dark:text-orange-400"
                aria-hidden="true"
              />
              Analytics
            </li>
          </ul>
          <Button asChild variant="link" className="mt-4 h-auto p-0">
            <Link href="/register">
              Get an API key
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>

        <Card className="overflow-hidden border-border/80 bg-[#0B0F19] p-0 text-left shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          </div>
          <pre className="overflow-x-auto p-5 text-sm leading-relaxed text-slate-200">
            <code>{`curl https://api.linkiq.io/api/v1/links \\
  -H "Authorization: Bearer lk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "destinationUrl": "https://example.com" }'`}</code>
          </pre>
        </Card>
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section id="pricing" className="border-t bg-background py-24 sm:py-32">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Simple, transparent pricing
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Start free. Upgrade as your links, clicks, and team grow.
          </p>
        </div>

        <div className="mx-auto mt-14 grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PRICING_TIERS.map(({ key, ...tier }) => (
            <PricingCard key={key} {...tier} />
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Need custom limits or dedicated support?{' '}
          <Link
            href="/register"
            className="font-medium text-orange-600 underline-offset-4 hover:underline dark:text-orange-400"
          >
            Talk to us about Enterprise
          </Link>
          .
        </p>
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
