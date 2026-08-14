'use client';

import type { TimeRangeValue } from '@linkiq/types';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@linkiq/ui';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { getOverview } from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

const RANGE_OPTIONS: { label: string; value: TimeRangeValue }[] = [
  { label: 'Today', value: 'today' },
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
];

function formatCents(amount: number, currency: string | null): string {
  if (currency === null) return (amount / 100).toLocaleString('en-US');
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency });
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {hint && (
        <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent>
      )}
    </Card>
  );
}

export default function AdminOverviewPage() {
  const [range, setRange] = React.useState<TimeRangeValue>('7d');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'overview', range],
    queryFn: () => getOverview(range),
  });

  return (
    <div>
      <AdminPageHeader
        title="Platform Overview"
        description="Real-time metrics across every workspace on LinkIQ."
        actions={RANGE_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            size="sm"
            variant={range === opt.value ? 'default' : 'outline'}
            onClick={() => setRange(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      />

      {isLoading && (
        <div role="status" aria-live="polite" className="py-12 text-center text-muted-foreground">
          Loading platform metrics…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load platform metrics.'}
        </div>
      )}

      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Users" value={data.users.total} hint={`${data.users.active} active`} />
            <MetricCard label="Workspaces" value={data.workspaces.total} />
            <MetricCard label="Active links" value={data.links.active} />
            <MetricCard label="Clicks (range)" value={data.clicks.inRange.toLocaleString()} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Active subscriptions" value={data.subscriptions.active} />
            <MetricCard label="Trialing" value={data.subscriptions.trialing} />
            <MetricCard label="Past due" value={data.subscriptions.pastDue} />
            <MetricCard
              label="Payment failures (range)"
              value={data.paymentFailures.inRange}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="MRR"
              value={formatCents(data.mrr.amount, data.mrr.currency)}
              hint={data.mrr.note ?? undefined}
            />
            <MetricCard
              label="Revenue collected (range)"
              value={formatCents(data.revenue.collectedInRange, data.revenue.currency)}
            />
            <MetricCard label="API requests (range)" value={data.apiRequests.inRange.toLocaleString()} />
            <MetricCard label="Webhook failures (range)" value={data.webhookFailures.inRange} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MetricCard
              label="Custom domains"
              value={data.domains.total}
              hint={`${data.domains.active} active`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
