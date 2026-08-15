import { Zap, ShieldCheck, Globe2, Users, Terminal } from 'lucide-react';

// Every capability below is a real, already-shipped product feature —
// deliberately not an unverifiable claim (an uptime percentage, a
// support-response SLA) the platform has no basis to assert.
const CAPABILITIES = [
  {
    icon: Zap,
    label: 'Fast redirects',
    sub: 'Cached, low-latency',
  },
  {
    icon: ShieldCheck,
    label: 'Secure by design',
    sub: 'Scoped API keys & RBAC',
  },
  {
    icon: Globe2,
    label: 'Custom domains',
    sub: 'Every link, on-brand',
  },
  {
    icon: Users,
    label: 'Team workspaces',
    sub: 'Role-based collaboration',
  },
  {
    icon: Terminal,
    label: 'Developer API',
    sub: 'REST + webhooks',
  },
] as const;

/** A technical "system readout" strip rather than a row of marketing
 * badges — thin dividers, monospace sub-labels, a slightly deeper
 * background level than the hero above it, so the page reads as
 * layered surfaces instead of one flat background. */
export function StatStrip() {
  return (
    <section className="border-b border-white/10 bg-muted py-6">
      <div className="container">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/5 sm:grid-cols-5">
          {CAPABILITIES.map((item) => (
            <div
              key={item.label}
              className="flex flex-col gap-1.5 bg-muted px-4 py-3.5"
            >
              <item.icon
                className="h-4 w-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-foreground">
                {item.label}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {item.sub}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
