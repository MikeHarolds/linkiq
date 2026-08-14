import { Button } from '@linkiq/ui';
import Link from 'next/link';

export function CtaSection() {
  return (
    <section className="bg-orange-50 py-20 dark:bg-orange-500/10">
      <div className="container flex flex-col items-center gap-6 text-center">
        <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Every click starts somewhere. Make yours count.
        </h2>
        <p className="max-w-md text-muted-foreground">
          Create your first branded link in minutes — no credit card required.
        </p>
        <Button asChild size="lg">
          <Link href="/register">Start for free</Link>
        </Button>
      </div>
    </section>
  );
}
