import { Card, CardContent } from '@linkiq/ui';
import type { LucideIcon } from 'lucide-react';

interface FeatureCardProps {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
}

export function FeatureCard({
  icon: Icon,
  eyebrow,
  title,
  description,
}: FeatureCardProps) {
  return (
    <Card className="border-border/80 transition-shadow duration-200 hover:shadow-md">
      <CardContent className="flex flex-col gap-4 p-6">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-orange-600 dark:text-orange-400">
            {eyebrow}
          </p>
          <h3 className="text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
