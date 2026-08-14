import { Link2, BarChart3, Globe2, Webhook, Users } from 'lucide-react';

import { FeatureCard } from './feature-card';

const FEATURES = [
  {
    icon: Link2,
    eyebrow: 'Shorten',
    title: 'Memorable, trackable links',
    description:
      'Turn long, unwieldy URLs into short, branded links you can share anywhere — created in seconds, tracked from the first click.',
  },
  {
    icon: BarChart3,
    eyebrow: 'Track',
    title: 'Real-time click intelligence',
    description:
      'Understand clicks, devices, countries, and referrers as they happen, broken down by link and by campaign.',
  },
  {
    icon: Globe2,
    eyebrow: 'Brand',
    title: 'Custom domains, your brand',
    description:
      'Connect your own domain so every link you share looks and feels like part of your product, not a third-party redirect.',
  },
  {
    icon: Webhook,
    eyebrow: 'Automate',
    title: 'API and webhooks built in',
    description:
      'Create and manage links programmatically, and get notified the moment something happens with real-time webhook events.',
  },
  {
    icon: Users,
    eyebrow: 'Scale',
    title: 'Teams, permissions, billing',
    description:
      'Invite your team with role-based access, and manage plans and usage from one workspace as you grow.',
  },
] as const;

export function FeatureGrid() {
  return (
    <section id="features" className="border-t bg-background py-24 sm:py-32">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Everything a link needs to work harder
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            One platform for creating, branding, tracking, and automating every
            link your team shares.
          </p>
        </div>
        <div className="mx-auto mt-16 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.eyebrow} {...feature} />
          ))}
        </div>
      </div>
    </section>
  );
}
