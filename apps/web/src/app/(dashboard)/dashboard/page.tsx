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

import { AnalyticsEmptyState } from '@/components/analytics/analytics-states';
import { getOverview, getTopLinks } from '@/lib/analytics-api';
import { getLinkStats } from '@/lib/links-api';
import { ApiError, useAuth } from '@/providers/auth-provider';

const LINK_STAT_CARDS = [
  { key: 'totalLinks' as const, label: 'Total links', icon: Link2 },
  { key: 'activeLinks' as const, label: 'Active', icon: Activity },
  { key: 'pausedLinks' as const, label: 'Paused', icon: Pause },
  { key: 'expiredLinks' as const, label: 'Expired', icon: Clock },
  { key: 'archivedLinks' as const, label: 'Archived', icon: Archive },
];

/** "Recent traffic" window for the overview page — a fixed, reasonable
 * default (not user-configurable here; the full analytics dashboard at
 * /dashboard/analytics is where date-range controls live). */
const OVERVIEW_ANALYTICS_PARAMS = { range: '30d' as const, timezone: 'UTC' };

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

  const linkStats = useQuery({
    queryKey: ['links', 'stats', currentWorkspaceId],
    queryFn: () => getLinkStats(currentWorkspaceId!),
    enabled: Boolean(currentWorkspaceId),
  });

  const clickOverview = useQuery({
    queryKey: [
      'analytics',
      'overview',
      currentWorkspaceId,
      OVERVIEW_ANALYTICS_PARAMS,
    ],
    queryFn: () => getOverview(currentWorkspaceId!, OVERVIEW_ANALYTICS_PARAMS),
    enabled: Boolean(currentWorkspaceId),
  });

  const topLinks = useQuery({
    queryKey: [
      'analytics',
      'top-links',
      currentWorkspaceId,
      OVERVIEW_ANALYTICS_PARAMS,
    ],
    queryFn: () => getTopLinks(currentWorkspaceId!, OVERVIEW_ANALYTICS_PARAMS),
    enabled: Boolean(currentWorkspaceId),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back{user ? `, ${user.firstName}` : ''}
        </h1>
        <p className="text-muted-foreground">
          {currentWorkspace
            ? `You're viewing ${currentWorkspace.name} as ${currentWorkspace.role.toLowerCase()}.`
            : 'Select a workspace to get started.'}
        </p>
      </div>

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
          {/* Structural counts, derived directly from link records. */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {LINK_STAT_CARDS.map(({ key, label, icon: Icon }) => (
              <Card key={key}>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="rounded-md bg-muted p-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold tabular-nums">
                      {linkStats.data[key]}
                    </p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Click/visitor traffic — real numbers from stored click events
              only (last 30 days), never fabricated. If there's no event
              data yet, this legitimately shows zero, not a placeholder
              number. */}
          <div className="grid grid-cols-2 gap-4 sm:w-1/2">
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-md bg-muted p-2">
                  <MousePointerClick className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums">
                    {clickOverview.isLoading
                      ? '—'
                      : (clickOverview.data?.totalClicks ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">Clicks (30d)</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-md bg-muted p-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums">
                    {clickOverview.isLoading
                      ? '—'
                      : (clickOverview.data?.uniqueVisitors ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Unique visitors (30d)
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
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
                        className="flex items-center justify-between py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {link.title ?? link.shortCode}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {link.destinationUrl}
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

            <Card>
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
                        <p className="truncate text-sm font-medium">
                          {link.title ?? link.shortCode}
                        </p>
                        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                          {link.clicks} clicks
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
