import Link from 'next/link';

import { Logo } from './logo';

interface NavLink {
  label: string;
  url: string;
}

// Fallback — used only when the admin hasn't configured any FOOTER nav
// items yet. Every link only points at a destination that actually
// exists today (in-page anchors, or a mailto for Contact).
const DEFAULT_FOOTER_PRODUCT: NavLink[] = [
  { label: 'Link Management', url: '/#features' },
  { label: 'Analytics', url: '/#features' },
  { label: 'Custom Domains', url: '/#features' },
  { label: 'QR Codes', url: '/#features' },
  { label: 'Campaigns', url: '/#features' },
];
const DEFAULT_FOOTER_DEVELOPERS: NavLink[] = [
  { label: 'API', url: '/#developers' },
  { label: 'Webhooks', url: '/#developers' },
];
const DEFAULT_FOOTER_COMPANY: NavLink[] = [{ label: 'Contact', url: 'mailto:support@linkiq.com' }];

interface SiteFooterProps {
  footerProduct?: NavLink[];
  footerDevelopers?: NavLink[];
  footerCompany?: NavLink[];
  logoUrl?: string | null;
  siteName?: string;
}

export function SiteFooter({ footerProduct, footerDevelopers, footerCompany, logoUrl, siteName }: SiteFooterProps) {
  const columns = [
    { title: 'Product', links: footerProduct && footerProduct.length > 0 ? footerProduct : DEFAULT_FOOTER_PRODUCT },
    { title: 'Developers', links: footerDevelopers && footerDevelopers.length > 0 ? footerDevelopers : DEFAULT_FOOTER_DEVELOPERS },
    { title: 'Company', links: footerCompany && footerCompany.length > 0 ? footerCompany : DEFAULT_FOOTER_COMPANY },
  ].filter((column) => column.links.length > 0);

  return (
    <footer className="border-t border-white/10 bg-background">
      <div
        aria-hidden="true"
        className="h-px w-full bg-gradient-to-r from-transparent via-primary/30 to-transparent"
      />
      <div className="container grid gap-10 py-16 sm:grid-cols-2 lg:grid-cols-5 lg:gap-8">
        <div className="sm:col-span-2 lg:col-span-2">
          <Logo logoUrl={logoUrl} siteName={siteName} />
          <p className="mt-4 max-w-xs text-sm text-muted-foreground">
            Every link is a data point. LinkIQ turns them into a system your
            whole team can see and act on.
          </p>
        </div>

        {columns.map((column) => (
          <div key={column.title}>
            <h3 className="text-sm font-semibold text-foreground">
              {column.title}
            </h3>
            <ul className="mt-4 space-y-3">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.url}
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
          <span>© {new Date().getFullYear()} {siteName ?? 'LinkIQ'}. All rights reserved.</span>
          <span className="font-mono text-xs">
            Link infrastructure for modern teams.
          </span>
        </div>
      </div>
    </footer>
  );
}
