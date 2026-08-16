import type { PublicLandingPageContentDto } from '@linkiq/types';

import { resolveLandingPageIcon } from './icon-map';

// Fallback — the Sprint 12 defaults, used only when the admin hasn't
// configured any stats yet (an empty database list, not an error).
const DEFAULT_STATS: PublicLandingPageContentDto['stats'] = [
  { label: 'Fast redirects', sublabel: 'Cached, low-latency', icon: 'Zap' },
  { label: 'Secure by design', sublabel: 'Scoped API keys & RBAC', icon: 'ShieldCheck' },
  { label: 'Custom domains', sublabel: 'Every link, on-brand', icon: 'Globe2' },
  { label: 'Team workspaces', sublabel: 'Role-based collaboration', icon: 'Users' },
  { label: 'Developer API', sublabel: 'REST + webhooks', icon: 'Terminal' },
];

interface StatStripProps {
  stats?: PublicLandingPageContentDto['stats'];
}

/** A technical "system readout" strip rather than a row of marketing
 * badges — thin dividers, monospace sub-labels, a slightly deeper
 * background level than the hero above it, so the page reads as
 * layered surfaces instead of one flat background. */
export function StatStrip({ stats }: StatStripProps) {
  const items = stats && stats.length > 0 ? stats : DEFAULT_STATS;
  if (items.length === 0) return null;

  return (
    <section className="border-b border-white/10 bg-muted py-6">
      <div className="container">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/5 sm:grid-cols-5">
          {items.map((item) => {
            const Icon = resolveLandingPageIcon(item.icon);
            return (
              <div key={item.label} className="flex flex-col gap-1.5 bg-muted px-4 py-3.5">
                <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="text-sm font-medium text-foreground">{item.label}</span>
                {item.sublabel && (
                  <span className="font-mono text-[11px] text-muted-foreground">{item.sublabel}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
