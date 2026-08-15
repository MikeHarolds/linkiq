'use client';

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@linkiq/ui';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Archive,
  Clock,
  Link2,
  MousePointerClick,
  Pause,
  Users,
} from 'lucide-react';
import NextLink from 'next/link';
import * as React from 'react';

import {
  AnalyticsEmptyState,
  MetricCard,
} from '@/components/analytics/analytics-states';
import { DashboardPageHeader } from '@/components/dashboard/dashboard-page-header';
import { getOverview, getTimeseries, getTopLinks } from '@/lib/analytics-api';
import { getLinkStats } from '@/lib/links-api';
import { ApiError, useAuth } from '@/providers/auth-provider';

const LINK_STAT_CARDS = [
  { key: 'totalLinks' as const, label: 'Total links', icon: Link2 },
  { key: 'activeLinks' as const, label: 'Active', icon: Activity },
  { key: 'pausedLinks' as const, label: 'Paused', icon: Pause },
  { key: 'expiredLinks' as const, label: 'Expired', icon: Clock },
  { key: 'archivedLinks' as const, label: 'Archived', icon: Archive },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Percentage change vs. a real prior-period figure from the same
 * endpoint — never a fabricated number. Returns null (no indicator
 * shown) when the prior period had zero, since "+∞%" isn't a
 * meaningful or honest thing to display. */
function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function statusBadgeVariant(
  status: string,
): 'success' | 'secondary' | 'outline' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'PAUSED') return 'secondary';
  return 'outline';
}

export default function DashboardOverviewPage() {
  const { user, workspaces, currentWorkspaceId } = useAuth();
  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId);

  // Fixed 30-day window (not user-configurable here — the full
  // Analytics page is where date-range controls live) plus the
  // immediately preceding 30 days, so the "change" figures below are a
  // real period-over-period comparison, not an invented percentage.
  const { current, previous } = React.useMemo(() => {
    const now = Date.now();
    return {
      current: {
        from: new Date(now - 30 * DAY_MS).toISOString(),
        to: new Date(now).toISOString(),
        timezone: 'UTC' as const,
      },
      previous: {
        from: new Date(now - 60 * DAY_MS).toISOString(),
        to: new Date(now - 30 * DAY_MS).toISOString(),
        timezone: 'UTC' as const,
      },
    };
  }, []);

  const linkStats = useQuery({
    queryKey: ['links', 'stats', currentWorkspaceId],
    queryFn: () => getLinkStats(currentWorkspaceId!),
    enabled: Boolean(currentWorkspaceId),
  });

  const clickOverview = useQuery({
    queryKey: ['analytics', 'overview', currentWorkspaceId, current],
    queryFn: () => getOverview(currentWorkspaceId!, current),
    enabled: Boolean(currentWorkspaceId),
  });

  const previousClickOverview = useQuery({
    queryKey: ['analytics', 'overview', currentWorkspaceId, previous],
    queryFn: () => getOverview(currentWorkspaceId!, previous),
    enabled: Boolean(currentWorkspaceId),
  });

  const clicksTimeseries = useQuery({
    queryKey: ['analytics', 'timeseries', currentWorkspaceId, current],
    queryFn: () =>
      getTimeseries(currentWorkspaceId!, { ...current, interval: 'day' }),
    enabled: Boolean(currentWorkspaceId),
  });

  const topLinks = useQuery({
    queryKey: ['analytics', 'top-links', currentWorkspaceId, current],
    queryFn: () => getTopLinks(currentWorkspaceId!, current),
    enabled: Boolean(currentWorkspaceId),
  });

  const clicksChange =
    clickOverview.data && previousClickOverview.data
      ? percentChange(
          clickOverview.data.totalClicks,
          previousClickOverview.data.totalClicks,
        )
      : null;
  const visitorsChange =
    clickOverview.data && previousClickOverview.data
      ? percentChange(
          clickOverview.data.uniqueVisitors,
          previousClickOverview.data.uniqueVisitors,
        )
      : null;
  const clicksSparkline = clicksTimeseries.data?.map((point) => point.clicks);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={`Welcome back${user ? `, ${user.firstName}` : ''}`}
        description={
          currentWorkspace
            ? `You're viewing ${currentWorkspace.name} as ${currentWorkspace.role.toLowerCase()}.`
            : 'Select a workspace to get started.'
        }
      />

      {!currentWorkspaceId ? null : linkStats.isLoading ? (
        <div
          role="status"
          aria-live="polite"
          className="text-sm text-muted-foreground"
        >
          Loading dashboard…
        </div>
      ) : linkStats.isError ? (
        <div role="alert" className="text-sm text-destructive">
          {linkStats.error instanceof ApiError
            ? linkStats.error.message
            : 'Failed to load dashboard stats.'}
        </div>
      ) : linkStats.data ? (
        <>
          {/* Real-time traffic instruments — a genuine period-over-period
              comparison (this 30d window vs. the prior 30d window) and a
              real daily-clicks trend line, both from already-implemented
              analytics endpoints. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MetricCard
              icon={MousePointerClick}
              label="Clicks (30d)"
              value={
                clickOverview.isLoading
                  ? '—'
                  : (clickOverview.data?.totalClicks ?? 0)
              }
              change={
                clicksChange !== null
                  ? { value: clicksChange, label: 'vs. previous 30 days' }
                  : undefined
              }
              sparkline={clicksSparkline}
            />
            <MetricCard
              icon={Users}
              label="Unique visitors (30d)"
              value={
                clickOverview.isLoading
                  ? '—'
                  : (clickOverview.data?.uniqueVisitors ?? 0)
              }
              change={
                visitorsChange !== null
                  ? { value: visitorsChange, label: 'vs. previous 30 days' }
                  : undefined
              }
            />
          </div>

          {/* Structural counts, derived directly from link records —
              point-in-time snapshots with no prior-period figure to
              compare against anywhere in the API, so no change indicator
              is shown here (a fabricated one would violate the "don't
              invent data" rule). */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {LINK_STAT_CARDS.map(({ key, label, icon }) => (
              <MetricCard
                key={key}
                icon={icon}
                label={label}
                value={linkStats.data[key]}
              />
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Recent links</CardTitle>
                <CardDescription>
                  The 5 most recently created links in this workspace.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {linkStats.data.recentLinks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No links yet.{' '}
                    <NextLink
                      href="/dashboard/links"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Create your first one
                    </NextLink>
                    .
                  </p>
                ) : (
                  <ul className="divide-y">
                    {linkStats.data.recentLinks.map((link) => (
                      <li
                        key={link.id}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {link.title ?? link.shortCode}
                          </p>
                          <p className="truncate font-mono text-xs text-primary">
                            {link.publicUrl
                              ? link.publicUrl.replace(/^https?:\/\//, '')
                              : link.shortCode}
                          </p>
                        </div>
                        <Badge variant={statusBadgeVariant(link.status)}>
                          {link.status.charAt(0) +
                            link.status.slice(1).toLowerCase()}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Top-performing links</CardTitle>
                <CardDescription>
                  By click volume over the last 30 days.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {topLinks.isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : !topLinks.data || topLinks.data.length === 0 ? (
                  <AnalyticsEmptyState message="No clicks recorded yet — once your links start getting traffic, the top performers will show up here." />
                ) : (
                  <ul className="divide-y">
                    {topLinks.data.slice(0, 5).map((link) => (
                      <li
                        key={link.linkId}
                        className="flex items-center justify-between py-2.5"
                      >
                        <p className="min-w-0 truncate text-sm font-medium">
                          {link.title ?? link.shortCode}
                        </p>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-primary">
                          {link.clicks.toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
