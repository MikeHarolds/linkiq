import type { ReactNode } from 'react';

import { AuthShell } from '@/components/auth/auth-shell';
import { getServerSiteConfig } from '@/lib/server/landing-page-data';

/**
 * Layout for authentication routes (login, register, password reset).
 * A two-column, dark, fintech-styled shell (Sprint 14) — the same
 * .auth-shell/.dark token scope hero-section.tsx's dashboard/marketing
 * counterparts use (see globals.css) — with the actual login/register/
 * forgot-password/reset-password form rendered on the right. See
 * components/auth/auth-shell.tsx for the left branding panel, which
 * varies its copy/visual between login and register.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const siteConfig = await getServerSiteConfig();

  return (
    <div className="auth-shell dark bg-background text-foreground">
      <AuthShell logoUrl={siteConfig.logoUrl} siteName={siteConfig.siteName}>
        {children}
      </AuthShell>
    </div>
  );
}
