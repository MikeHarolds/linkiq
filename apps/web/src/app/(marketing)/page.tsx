import { Button } from '@linkiq/ui';
import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="container flex flex-col items-center justify-center gap-6 py-32 text-center">
      <span className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
        Foundation Milestone
      </span>
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-6xl">
        Link management, built for teams that move fast.
      </h1>
      <p className="max-w-xl text-lg text-muted-foreground">
        Smart URL shortening, real-time analytics, and AI-powered insights —
        product features land in upcoming sprints. This is the platform
        foundation.
      </p>
      <div className="flex gap-3">
        <Button asChild size="lg">
          <Link href="/register">Get started</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/login">Log in</Link>
        </Button>
      </div>
    </div>
  );
}
