import { Link2, BarChart3, Globe2, Webhook, Users } from 'lucide-react';

import { FeatureCard } from './feature-card';

const FEATURES = [
  {
    icon: Link2,
    title: 'Shorten',
    description: 'Turn any URL into a clean, brandable link in milliseconds.',
  },
  {
    icon: BarChart3,
    title: 'Track',
    description: 'See clicks, visitors, and sources the moment they happen.',
  },
  {
    icon: Globe2,
    title: 'Brand',
    description: 'Route every link through a domain your audience recognizes.',
  },
  {
    icon: Webhook,
    title: 'Automate',
    description: 'Create links and react to activity from your own systems.',
  },
  {
    icon: Users,
    title: 'Scale',
    description: 'Workspaces, roles, and permissions built for real teams.',
  },
] as const;

export function FeatureGrid() {
  return (
    <section
      id="features"
      className="border-t border-white/10 bg-background py-20 sm:py-24"
    >
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-xs font-semibold uppercase tracking-wide text-primary">
            The core loop
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Everything a link needs to do its job
          </h2>
          <p className="mt-4 text-muted-foreground">
            From the moment you shorten it to the moment someone acts on it.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {FEATURES.map((feature, i) => (
            <FeatureCard
              key={feature.title}
              index={String(i + 1).padStart(2, '0')}
              {...feature}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
