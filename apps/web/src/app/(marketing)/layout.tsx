import { Button } from '@linkiq/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Layout for public marketing pages (landing, pricing, etc.).
 * Adds a simple top nav and footer around every route in this group.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            LinkIQ
          </Link>
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/register">Sign up</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t">
        <div className="container flex h-16 items-center justify-between text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} LinkIQ. All rights reserved.</span>
          <span>Built with Next.js &amp; NestJS</span>
        </div>
      </footer>
    </div>
  );
}
