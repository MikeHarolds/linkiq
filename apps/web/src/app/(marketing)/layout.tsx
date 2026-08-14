import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';

/**
 * Layout for public marketing pages (landing page today; pricing/etc.
 * could join this group later). Wraps every route in this group with
 * the marketing-specific header and footer — deliberately separate
 * from (dashboard)/layout.tsx and (admin)/layout.tsx, which have their
 * own authenticated shells.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
