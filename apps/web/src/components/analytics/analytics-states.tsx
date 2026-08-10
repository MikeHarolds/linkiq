'use client';

import { Card, CardContent } from '@linkiq/ui';
import type { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: number | string;
  icon?: LucideIcon;
}

export function MetricCard({ label, value, icon: Icon }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        {Icon && (
          <div className="rounded-md bg-muted p-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        <div>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function AnalyticsLoadingState({
  label = 'Loading analytics…',
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="py-12 text-center text-sm text-muted-foreground"
    >
      {label}
    </div>
  );
}

export function AnalyticsErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="py-12 text-center text-sm text-destructive">
      {message}
    </div>
  );
}

export function AnalyticsEmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
