import { resolveLandingPageIcon } from './icon-map';

interface FeatureCardProps {
  icon: string;
  index: string;
  title: string;
  description: string;
}

export function FeatureCard({
  icon,
  index,
  title,
  description,
}: FeatureCardProps) {
  const Icon = resolveLandingPageIcon(icon);
  return (
    <div className="group relative flex flex-1 flex-col gap-3 overflow-hidden rounded-xl border border-white/10 bg-card p-5 transition-colors duration-200 hover:border-primary/30">
      {/* Thin top accent line that lights up on hover — a restrained
          "powered" cue instead of a full glowing border. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
      />
      <div className="flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <span className="font-mono text-xs text-muted-foreground/60">
          {index}
        </span>
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
