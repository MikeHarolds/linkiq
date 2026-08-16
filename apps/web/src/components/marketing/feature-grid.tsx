import type { PublicLandingPageContentDto } from '@linkiq/types';

import { FeatureCard } from './feature-card';

const DEFAULT_SECTION = {
  eyebrow: 'The core loop',
  headline: 'Everything a link needs to do its job',
  description: 'From the moment you shorten it to the moment someone acts on it.',
};

const DEFAULT_FEATURES: PublicLandingPageContentDto['features'] = [
  { title: 'Shorten', description: 'Turn any URL into a clean, brandable link in milliseconds.', icon: 'Link2' },
  { title: 'Track', description: 'See clicks, visitors, and sources the moment they happen.', icon: 'BarChart3' },
  { title: 'Brand', description: 'Route every link through a domain your audience recognizes.', icon: 'Globe2' },
  { title: 'Automate', description: 'Create links and react to activity from your own systems.', icon: 'Webhook' },
  { title: 'Scale', description: 'Workspaces, roles, and permissions built for real teams.', icon: 'Users' },
];

interface FeatureGridProps {
  content?: PublicLandingPageContentDto['sections'][number];
  features?: PublicLandingPageContentDto['features'];
}

export function FeatureGrid({ content, features }: FeatureGridProps) {
  const eyebrow = content?.eyebrow ?? DEFAULT_SECTION.eyebrow;
  const headline = content?.headline ?? DEFAULT_SECTION.headline;
  const description = content?.description ?? DEFAULT_SECTION.description;
  const items = features && features.length > 0 ? features : DEFAULT_FEATURES;

  if (items.length === 0) return null;

  return (
    <section id="features" className="border-t border-white/10 bg-background py-20 sm:py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          {eyebrow && (
            <p className="font-mono text-xs font-semibold uppercase tracking-wide text-primary">{eyebrow}</p>
          )}
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{headline}</h2>
          {description && <p className="mt-4 text-muted-foreground">{description}</p>}
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {items.map((feature, i) => (
            <FeatureCard key={feature.title} index={String(i + 1).padStart(2, '0')} {...feature} />
          ))}
        </div>
      </div>
    </section>
  );
}
