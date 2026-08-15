import { Button } from '@linkiq/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

export function CtaSection() {
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
            Start seeing what happens after the click.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Free forever plan. No credit card required.
          </p>
        </div>
        <Button asChild size="lg" className="shrink-0">
          <Link href="/register">
            Get started for free
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
