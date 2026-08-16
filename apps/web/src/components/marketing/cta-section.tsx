import type { PublicLandingPageContentDto } from '@linkiq/types';
import { Button } from '@linkiq/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

const DEFAULTS = {
  headline: 'Start seeing what happens after the click.',
  description: 'Free forever plan. No credit card required.',
  primaryCtaText: 'Get started for free',
  primaryCtaUrl: '/register',
};

interface CtaSectionProps {
  content?: PublicLandingPageContentDto['sections'][number];
}

export function CtaSection({ content }: CtaSectionProps) {
  const headline = content?.headline ?? DEFAULTS.headline;
  const description = content?.description ?? DEFAULTS.description;
  const primaryCtaText = content?.primaryCtaText ?? DEFAULTS.primaryCtaText;
  const primaryCtaUrl = content?.primaryCtaUrl ?? DEFAULTS.primaryCtaUrl;

  return (
    <section className="relative overflow-hidden border-t border-white/10 bg-dash-elevated py-16">
      <div
        aria-hidden="true"
        className="bg-grid-dots pointer-events-none absolute inset-0 opacity-[0.1]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_80%_at_15%_50%,hsl(var(--primary)/0.18),transparent),radial-gradient(ellipse_50%_80%_at_85%_50%,hsl(var(--primary)/0.14),transparent)]"
      />
      <div className="container relative flex flex-col items-center justify-between gap-6 text-center sm:flex-row sm:text-left">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {headline}
          </h2>
          {description && (
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {primaryCtaText && (
          <Button asChild size="lg" className="shrink-0">
            <Link href={primaryCtaUrl ?? '/register'}>
              {primaryCtaText}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>
    </section>
  );
}
