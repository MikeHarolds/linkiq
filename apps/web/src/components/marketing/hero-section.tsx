'use client';

import { Button } from '@linkiq/ui';
import { ArrowRight, Globe2, MousePointerClick, QrCode } from 'lucide-react';
import Link from 'next/link';

/** Real, already-shipped click/country figures this preview reuses —
 * deliberately not an invented "conversion rate" or similar metric the
 * product doesn't track. Static and clearly labeled as illustrative,
 * per the "no fabricated backend functionality" constraint. */
const MAIN_LINK = {
  domain: 'go.acme.com',
  slug: 'summer',
  destination: 'acme.com/campaigns/summer-sale',
  clicks: '4,821',
  countries: '38',
  devices: '3',
};

const SPARK = [6, 9, 7, 12, 10, 15, 13, 18, 16, 22, 19, 26];

/** A tiny CSS-drawn QR-like grid — visually reads as a QR code (for the
 * "distribute" panel) without claiming to encode anything real or
 * being a scannable stand-in for actual product output. */
function QrGlyph() {
  const cells = [
    1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1,
    1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1,
    0, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1,
    0, 1, 0, 1, 1, 1,
  ];
  return (
    <div className="grid grid-cols-9 gap-[1.5px]" aria-hidden="true">
      {cells.map((on, i) => (
        <span
          key={i}
          // Fixed dark-on-white regardless of theme — a QR code's
          // contrast is what makes it read as a QR code; tying its
          // cells to --foreground would invert to white-on-white in
          // dark mode against the deliberately white scan backing below.
          className={`h-1 w-1 rounded-[1px] ${on ? 'bg-slate-900' : 'bg-transparent'}`}
        />
      ))}
    </div>
  );
}

/** A layered composition of small, self-contained UI panels — built
 * from the same tokens/typography as the real dashboard, not a stock
 * illustration. Each panel stands in for one stage of the product
 * loop (create a link, distribute it, watch it get clicked, read the
 * signal) without literally labeling itself as a numbered diagram. */
function ProductVisualization() {
  const maxSpark = Math.max(...SPARK);

  return (
    <div
      className="relative w-full max-w-lg sm:pb-28 sm:pt-36"
      role="img"
      aria-label="Illustrative preview of the LinkIQ product: a short link go.acme.com/summer pointing to acme.com/campaigns/summer-sale, with a QR code for distribution, a live click signal, and a small click-activity chart."
    >
      {/* Connection geometry — a thin orange gradient thread linking the
          floating panels to the main console, an abstract nod to "link"
          without becoming a literal flowchart arrow. */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden sm:block"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="threadGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            <stop
              offset="50%"
              stopColor="hsl(var(--primary))"
              stopOpacity="0.5"
            />
            <stop
              offset="100%"
              stopColor="hsl(var(--primary))"
              stopOpacity="0"
            />
          </linearGradient>
        </defs>
        <path
          d="M 78 12 Q 65 17 58 22"
          stroke="url(#threadGradient)"
          strokeWidth="0.4"
          fill="none"
        />
        <path
          d="M 22 88 Q 35 82 42 77"
          stroke="url(#threadGradient)"
          strokeWidth="0.4"
          fill="none"
        />
      </svg>

      {/* Main console panel — the created link + its live signal. Sits
          vertically between the two floating panels (which live in
          this wrapper's top/bottom padding, see below) rather than
          under them, so nothing overlaps or gets obscured. */}
      <div className="relative rounded-2xl border border-white/10 bg-card p-0 shadow-[0_0_70px_-20px_hsl(var(--primary)/0.35)]">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span
              className="animate-signal-pulse h-1.5 w-1.5 rounded-full bg-emerald-400"
              aria-hidden="true"
            />
            <span className="font-mono text-sm font-medium text-primary">
              {MAIN_LINK.domain}/{MAIN_LINK.slug}
            </span>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Active
          </span>
        </div>

        <div className="flex items-center gap-1.5 border-b border-white/5 px-5 py-2.5 text-xs text-muted-foreground">
          <Globe2 className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{MAIN_LINK.destination}</span>
        </div>

        <div className="grid grid-cols-3 divide-x divide-white/5 border-b border-white/5">
          {[
            { label: 'Clicks', value: MAIN_LINK.clicks },
            { label: 'Countries', value: MAIN_LINK.countries },
            { label: 'Devices', value: MAIN_LINK.devices },
          ].map((stat) => (
            <div key={stat.label} className="px-4 py-3">
              <p className="text-base font-semibold tabular-nums text-foreground">
                {stat.value}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {stat.label}
              </p>
            </div>
          ))}
        </div>

        <div className="px-5 py-4">
          <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            Click activity
          </p>
          <div className="flex h-10 items-end gap-1" aria-hidden="true">
            {SPARK.map((v, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-sm bg-gradient-to-t from-primary/70 to-primary/20"
                style={{ height: `${(v / maxSpark) * 100}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Floating panel — distribute (QR + destination brand). Anchored
          to this wrapper's top-right, inside the pt-16/pt-20 padding
          reserved above the main card, so it never overlaps it. */}
      <div className="absolute right-2 top-0 hidden w-36 rounded-xl border border-white/10 bg-dash-elevated p-3 shadow-xl sm:block">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          <QrCode className="h-3 w-3" aria-hidden="true" />
          Distribute
        </div>
        <div className="mt-2 flex items-center justify-center rounded-md bg-white p-2">
          <QrGlyph />
        </div>
      </div>

      {/* Floating panel — a live click signal. Anchored to this
          wrapper's bottom-left, inside the pb-16/pb-20 padding
          reserved below the main card, so it never overlaps it. */}
      <div className="absolute bottom-0 left-2 hidden w-44 rounded-xl border border-white/10 bg-dash-elevated p-3 shadow-xl sm:block">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          <MousePointerClick className="h-3 w-3" aria-hidden="true" />
          Live signal
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className="animate-signal-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
            aria-hidden="true"
          />
          <p className="text-xs text-foreground">Click from Lagos, NG</p>
        </div>
        <p className="mt-0.5 pl-3.5 text-[10px] text-muted-foreground">
          via QR · mobile
        </p>
      </div>
    </div>
  );
}

const TRUST_BULLETS = [
  'No credit card required',
  'Free forever plan',
  'Upgrade anytime',
] as const;

export function HeroSection() {
  return (
    <section className="relative overflow-hidden border-b border-white/10 bg-background">
      <div
        aria-hidden="true"
        className="bg-grid-dots pointer-events-none absolute inset-0 opacity-[0.15] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,hsl(var(--primary)/0.16),transparent)]"
      />
      <div className="container relative grid items-center gap-16 py-20 sm:py-28 lg:grid-cols-2 lg:gap-16 lg:py-32">
        <div className="flex flex-col items-start gap-6 text-left">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            <span
              className="animate-signal-pulse h-1.5 w-1.5 rounded-full bg-primary"
              aria-hidden="true"
            />
            Link intelligence platform
          </span>
          <h1 className="max-w-xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Every link tells a story.
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">
            LinkIQ shows you what happens after the click — who clicked, where
            they went, and what to do next. Short links, custom domains, and
            analytics built as one system, not three bolted-together tools.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/register">
                Get started for free
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#pricing">View pricing</Link>
            </Button>
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {TRUST_BULLETS.map((bullet) => (
              <li key={bullet} className="flex items-center gap-1.5">
                <span
                  className="h-1 w-1 rounded-full bg-primary"
                  aria-hidden="true"
                />
                {bullet}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-center pt-6 lg:justify-end lg:pt-0">
          <ProductVisualization />
        </div>
      </div>
    </section>
  );
}
