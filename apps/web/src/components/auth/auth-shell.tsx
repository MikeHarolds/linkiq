'use client';

import { BarChart3, CheckCircle2, Globe2, ShieldCheck, Zap } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Logo } from '@/components/marketing/logo';

interface AuthShellProps {
  logoUrl?: string | null;
  siteName?: string;
  children: ReactNode;
}

const LOGIN_BENEFITS = [
  { icon: Zap, label: 'Fast redirects', sub: 'Cached, low-latency' },
  { icon: BarChart3, label: 'Real-time analytics', sub: 'Every click, tracked' },
  { icon: Globe2, label: 'Custom domains', sub: 'Every link, on-brand' },
];

const REGISTER_BENEFITS = [
  'Free forever plan — no credit card required',
  'Custom domains for every branded link',
  'Real-time click, referrer, and geography analytics',
  'Team workspaces with role-based access',
  'A REST API and webhooks for automation',
];

/** A compact reuse of the marketing hero's "console card" visual
 * language (deep-dark panel, orange accent, live-signal dot) — not the
 * full layered composition from hero-section.tsx (that needs far more
 * horizontal room than an auth page's side panel has), just its
 * vocabulary: a real-looking LinkIQ link, a status pulse, a small
 * stat row. */
function MiniConsolePreview() {
  return (
    <div className="w-full max-w-xs rounded-2xl border border-white/10 bg-card shadow-[0_0_60px_-20px_hsl(var(--primary)/0.35)]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-signal-pulse rounded-full bg-emerald-400" aria-hidden="true" />
          <span className="font-mono text-xs font-medium text-primary">go.acme.com/launch</span>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
          Active
        </span>
      </div>
      <div className="grid grid-cols-3 divide-x divide-white/5">
        {[
          { label: 'Clicks', value: '4,821' },
          { label: 'Countries', value: '38' },
          { label: 'Devices', value: '3' },
        ].map((stat) => (
          <div key={stat.label} className="px-3 py-3">
            <p className="text-sm font-semibold tabular-nums text-foreground">{stat.value}</p>
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AuthShell({ logoUrl, siteName, children }: AuthShellProps) {
  const pathname = usePathname();
  const isRegister = pathname?.startsWith('/register');

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left — branding panel. Hidden below lg to keep mobile focused
          on the form (Part 10's explicit mobile requirement); a
          compact logo + one-line tagline still appears above the form
          on every breakpoint via the header below. */}
      <div className="relative hidden overflow-hidden border-r border-white/10 bg-background lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden="true"
          className="bg-grid-dots pointer-events-none absolute inset-0 opacity-[0.12] [mask-image:radial-gradient(ellipse_70%_60%_at_30%_20%,black,transparent)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_50%_at_20%_0%,hsl(var(--primary)/0.16),transparent)]"
        />

        <Logo logoUrl={logoUrl} siteName={siteName} className="relative" />

        <div className="relative flex flex-col gap-8">
          {isRegister ? (
            <>
              <div>
                <h2 className="max-w-sm text-3xl font-bold tracking-tight text-foreground">
                  Every link tells a story. Start writing yours.
                </h2>
                <p className="mt-3 max-w-sm text-muted-foreground">
                  Create a free workspace and see exactly what happens after the click.
                </p>
              </div>
              <ul className="space-y-3">
                {REGISTER_BENEFITS.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-2.5 text-sm text-foreground">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    {benefit}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div>
                <h2 className="max-w-sm text-3xl font-bold tracking-tight text-foreground">
                  Every link tells a story.
                </h2>
                <p className="mt-3 max-w-sm text-muted-foreground">
                  LinkIQ shows you what happens after the click — who clicked, where they went, and what to do next.
                </p>
              </div>
              <MiniConsolePreview />
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {LOGIN_BENEFITS.map((item) => (
                  <div key={item.label} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <item.icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    {item.label}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="relative flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          Secure by design — scoped API keys & role-based access
        </div>
      </div>

      {/* Right — the actual form. Compact branding header shown here
          too (always, including on mobile, where the left panel above
          is hidden entirely). */}
      <div className="flex flex-col items-center justify-center gap-8 bg-background px-4 py-12">
        <Logo logoUrl={logoUrl} siteName={siteName} className="lg:hidden" />
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
