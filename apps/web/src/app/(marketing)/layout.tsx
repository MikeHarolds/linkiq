import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { getServerLandingPageContent, getServerSiteConfig } from '@/lib/server/landing-page-data';

/**
 * Layout for public marketing pages (landing page today; pricing/etc.
 * could join this group later). Wraps every route in this group with
 * the marketing-specific header and footer — deliberately separate
 * from (dashboard)/layout.tsx and (admin)/layout.tsx, which have their
 * own authenticated shells.
 *
 * Fetches nav items + site branding server-side (Sprint 14) so the
 * header/footer render real, admin-editable content on first paint —
 * no client-side loading flicker. See lib/server/landing-page-data.ts
 * for why this is an uncached fetch (defers caching entirely to the
 * backend's own short-lived in-memory cache).
 */
export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const [content, siteConfig] = await Promise.all([
    getServerLandingPageContent(),
    getServerSiteConfig(),
  ]);

  return (
    // The marketing site is intentionally always dark — a fixed brand
    // choice, not a light/dark preference — independent of the
    // system/user theme toggle that (dashboard) and (admin) respect.
    // Tailwind's `darkMode: ['class']` config means this single class
    // flips every semantic token (bg-background, text-foreground, the
    // `dark:` variants already used throughout components/marketing)
    // for this whole subtree. `text-foreground` is set explicitly here
    // (not just bg-background) because plain CSS `color` inheritance
    // otherwise falls through to <body>'s already-computed light-mode
    // color — body sits outside this scoped .dark div, so anything in
    // this subtree that doesn't set its own text color (e.g. a button
    // variant with no explicit text-* class) would silently inherit
    // the wrong, low-contrast value instead of re-resolving here.
    <div className="marketing-shell dark flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader
        navItems={content.navItems.header}
        logoUrl={siteConfig.logoUrl}
        siteName={siteConfig.siteName}
      />
      <main className="flex-1">{children}</main>
      <SiteFooter
        footerProduct={content.navItems.footerProduct}
        footerDevelopers={content.navItems.footerDevelopers}
        footerCompany={content.navItems.footerCompany}
        logoUrl={siteConfig.logoUrl}
        siteName={siteConfig.siteName}
      />
    </div>
  );
}
