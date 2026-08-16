'use client';

import { Button } from '@linkiq/ui';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Logo } from './logo';

// Fallback — used only when the admin hasn't configured any HEADER nav
// items yet (an empty database list). Anchor links into sections of
// the single landing page rather than separate routes — there is no
// standalone /product, /pricing, or /developers page.
const DEFAULT_NAV_LINKS = [
  { label: 'Product', url: '/#features' },
  { label: 'Pricing', url: '/#pricing' },
  { label: 'Developers', url: '/#developers' },
];

interface SiteHeaderProps {
  navItems?: Array<{ label: string; url: string }>;
  logoUrl?: string | null;
  siteName?: string;
}

export function SiteHeader({ navItems, logoUrl, siteName }: SiteHeaderProps) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const links = navItems && navItems.length > 0 ? navItems : DEFAULT_NAV_LINKS;

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-background/80 backdrop-blur">
      {/* Fine orange gradient hairline — a restrained "powered on"
          signal rather than a full-width flat brand bar. */}
      <div
        aria-hidden="true"
        className="h-px w-full bg-gradient-to-r from-transparent via-primary/50 to-transparent"
      />
      <div className="container flex h-16 items-center justify-between">
        <Logo logoUrl={logoUrl} siteName={siteName} />

        <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
          {links.map((link) => (
            <Link
              key={link.url}
              href={link.url}
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
          className="border-t border-white/10 bg-background px-4 pb-6 pt-2 md:hidden"
        >
          <ul className="flex flex-col gap-1">
            {links.map((link) => (
              <li key={link.url}>
                <Link
                  href={link.url}
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
