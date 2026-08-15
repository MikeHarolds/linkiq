'use client';

import { Card, CardContent } from '@linkiq/ui';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';

interface MetricChange {
  /** Percentage change vs. the prior period, e.g. 12.4 or -3.1. */
  value: number;
  /** What it's compared against, e.g. "vs. previous 30 days". */
  label: string;
}

interface MetricCardProps {
  label: string;
  value: number | string;
  icon?: LucideIcon;
  /** Real period-over-period comparison — both the current and prior
   * numbers come from the same API the metric itself does, never
   * invented. Omit entirely when no prior-period figure exists (e.g. a
   * point-in-time structural count with nothing to compare against). */
  change?: MetricChange;
  /** A genuine time series for this exact metric (the same data the
   * Analytics page's own chart uses), rendered as a small inline trend
   * line. Omit when no such series exists for this metric. */
  sparkline?: number[];
}

function ChangeIndicator({ change }: { change: MetricChange }) {
  const direction =
    change.value > 0 ? 'up' : change.value < 0 ? 'down' : 'flat';
  const Icon =
    direction === 'up'
      ? ArrowUpRight
      : direction === 'down'
        ? ArrowDownRight
        : Minus;
  const color =
    direction === 'up'
      ? 'text-emerald-600 dark:text-emerald-400'
      : direction === 'down'
        ? 'text-red-600 dark:text-red-400'
        : 'text-muted-foreground';

  return (
    <div className="mt-1.5 flex items-center gap-1 text-xs">
      <span className={`flex items-center gap-0.5 font-medium ${color}`}>
        <Icon className="h-3 w-3" aria-hidden="true" />
        {Math.abs(change.value).toFixed(1)}%
      </span>
      <span className="truncate text-muted-foreground">{change.label}</span>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  change,
  sparkline,
}: MetricCardProps) {
  return (
    <Card className="group transition-colors duration-150 hover:border-primary/30">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
            <p className="truncate text-xs text-muted-foreground">{label}</p>
            {change && <ChangeIndicator change={change} />}
          </div>
        </div>

        {sparkline && sparkline.length > 1 && (
          <div
            className="h-9 w-16 shrink-0"
            role="img"
            aria-label={`Trend for ${label}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkline.map((v) => ({ v }))}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="hsl(var(--primary))"
                  strokeWidth={1.75}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
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
