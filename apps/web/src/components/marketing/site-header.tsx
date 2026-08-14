'use client';

import { Button } from '@linkiq/ui';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Logo } from './logo';

// Anchor links into sections of the single landing page rather than
// separate routes — there is no standalone /product, /pricing, or
// /developers page yet, and the brief is explicit about not inventing
// placeholder routes just to populate navigation.
const NAV_LINKS = [
  { label: 'Product', href: '/#features' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'Developers', href: '/#developers' },
] as const;

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="container flex h-16 items-center justify-between">
        <Logo />

        <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/register">Get started</Link>
          </Button>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? (
            <X className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Menu className="h-5 w-5" aria-hidden="true" />
          )}
        </Button>
      </div>

      {mobileOpen && (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="border-t bg-background px-4 pb-6 pt-2 md:hidden"
        >
          <ul className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="block rounded-md px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-col gap-2 border-t pt-4">
            <Button
              asChild
              variant="outline"
              className="w-full"
              onClick={() => setMobileOpen(false)}
            >
              <Link href="/login">Log in</Link>
            </Button>
            <Button
              asChild
              className="w-full"
              onClick={() => setMobileOpen(false)}
            >
              <Link href="/register">Get started</Link>
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
}
