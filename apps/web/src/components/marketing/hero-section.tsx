import { Badge, Button, Card } from '@linkiq/ui';
import {
  ArrowDown,
  Globe2,
  Link2,
  MousePointerClick,
  Smartphone,
  Copy,
} from 'lucide-react';
import Link from 'next/link';

const HERO_STATS = [
  { label: 'Clicks', value: '12.8K', icon: MousePointerClick },
  { label: 'CTR', value: '8.4%', icon: Link2 },
  { label: 'Countries', value: '24', icon: Globe2 },
  { label: 'Devices', value: '68%', icon: Smartphone },
] as const;

/** A CSS/component-built product preview — deliberately not a stock
 * illustration or screenshot, so it reads as an actual LinkIQ mockup
 * (link creation + resulting stats) rather than generic hero art. */
function ProductPreviewCard() {
  return (
    <Card className="w-full max-w-md border-border/80 p-1.5 shadow-lg">
      <div className="flex items-center gap-1.5 px-3 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-muted" />
        <span className="h-2.5 w-2.5 rounded-full bg-muted" />
        <span className="h-2.5 w-2.5 rounded-full bg-muted" />
        <span className="ml-2 text-xs font-medium text-muted-foreground">
          Create a link
        </span>
      </div>

      <div className="space-y-3 px-4 pb-4">
        <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
          https://example.com/summer-campaign
        </div>

        <div className="flex justify-center text-muted-foreground">
          <ArrowDown className="h-4 w-4" aria-hidden="true" />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5 text-sm font-medium text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300">
          <span>linkiq.io/summer26</span>
          <Copy className="h-4 w-4 shrink-0" aria-hidden="true" />
        </div>

        <div className="grid grid-cols-4 gap-2 pt-2">
          {HERO_STATS.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center gap-1 rounded-lg border bg-background px-2 py-3 text-center"
            >
              <stat.icon
                className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400"
                aria-hidden="true"
              />
              <span className="text-sm font-semibold tracking-tight text-foreground">
                {stat.value}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function HeroSection() {
  return (
    <section className="overflow-hidden border-b bg-background">
      <div className="container grid items-center gap-12 py-20 sm:py-28 lg:grid-cols-2 lg:gap-16 lg:py-32">
        <div className="flex flex-col items-start gap-6 text-left">
          <Badge
            variant="outline"
            className="border-orange-200 bg-orange-50 text-xs font-semibold uppercase tracking-wide text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300"
          >
            Link management for modern teams
          </Badge>
          <h1 className="max-w-xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Turn every link into a growth engine.
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">
            Shorten, brand, track, and optimize every link from one powerful
            platform built for modern teams.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/register">Start for free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#product">Explore the platform</Link>
            </Button>
          </div>
        </div>

        <div className="flex justify-center lg:justify-end">
          <ProductPreviewCard />
        </div>
      </div>
    </section>
  );
}
