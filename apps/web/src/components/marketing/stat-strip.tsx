const CAPABILITIES = [
  { value: '1 platform', label: 'Links, analytics, and automation' },
  { value: 'Real-time', label: 'Click intelligence as it happens' },
  { value: 'Custom', label: 'Branded domains for every link' },
  { value: 'Developer-ready', label: 'REST API and webhooks' },
] as const;

/** Capability statements, not usage metrics — deliberately not framed
 * as customer/traffic numbers, since none exist to report truthfully. */
export function StatStrip() {
  return (
    <section className="border-y bg-muted/30 py-16">
      <div className="container">
        <dl className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {CAPABILITIES.map((item) => (
            <div key={item.value} className="text-center sm:text-left">
              <dt className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {item.value}
              </dt>
              <dd className="mt-1 text-sm text-muted-foreground">
                {item.label}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
