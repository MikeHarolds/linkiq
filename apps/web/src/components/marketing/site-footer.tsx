import Link from 'next/link';

import { Logo } from './logo';

// Every column below only links to a destination that actually exists
// today — in-page anchors on the landing page itself, or a mailto for
// Contact. The brief's suggested Company/Legal items (About, Privacy,
// Terms) have no real page behind them yet and are intentionally
// omitted rather than pointing at placeholder routes; see the
// redesign report for the full reasoning.
const FOOTER_COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Link Management', href: '/#features' },
      { label: 'Analytics', href: '/#features' },
      { label: 'Custom Domains', href: '/#features' },
      { label: 'QR Codes', href: '/#features' },
      { label: 'Campaigns', href: '/#features' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'API', href: '/#developers' },
      { label: 'Webhooks', href: '/#developers' },
    ],
  },
  {
    title: 'Company',
    links: [{ label: 'Contact', href: 'mailto:support@linkiq.com' }],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-background">
      <div
        aria-hidden="true"
        className="h-px w-full bg-gradient-to-r from-transparent via-primary/30 to-transparent"
      />
      <div className="container grid gap-10 py-16 sm:grid-cols-2 lg:grid-cols-5 lg:gap-8">
        <div className="sm:col-span-2 lg:col-span-2">
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-muted-foreground">
            Every link is a data point. LinkIQ turns them into a system your
            whole team can see and act on.
          </p>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <div key={column.title}>
            <h3 className="text-sm font-semibold text-foreground">
              {column.title}
            </h3>
            <ul className="mt-4 space-y-3">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-white/10">
        <div className="container flex flex-col items-center justify-between gap-2 py-6 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} LinkIQ. All rights reserved.</span>
          <span className="font-mono text-xs">
            Link infrastructure for modern teams.
          </span>
        </div>
      </div>
    </footer>
  );
}
