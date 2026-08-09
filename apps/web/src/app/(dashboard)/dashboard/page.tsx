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
import { Activity, Archive, Clock, Link2, Pause } from 'lucide-react';
import NextLink from 'next/link';

import { getLinkStats } from '@/lib/links-api';
import { ApiError, useAuth } from '@/providers/auth-provider';

const STAT_CARDS = [
  { key: 'totalLinks' as const, label: 'Total links', icon: Link2 },
  { key: 'activeLinks' as const, label: 'Active', icon: Activity },
  { key: 'pausedLinks' as const, label: 'Paused', icon: Pause },
  { key: 'expiredLinks' as const, label: 'Expired', icon: Clock },
  { key: 'archivedLinks' as const, label: 'Archived', icon: Archive },
];

export default function DashboardOverviewPage() {
  const { user, workspaces, currentWorkspaceId } = useAuth();
  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['links', 'stats', currentWorkspaceId],
    queryFn: () => getLinkStats(currentWorkspaceId!),
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

      {!currentWorkspaceId ? null : isLoading ? (
        <div
          role="status"
          aria-live="polite"
          className="text-sm text-muted-foreground"
        >
          Loading dashboard…
        </div>
      ) : isError ? (
        <div role="alert" className="text-sm text-destructive">
          {error instanceof ApiError
            ? error.message
            : 'Failed to load dashboard stats.'}
        </div>
      ) : data ? (
        <>
          {/* These are structural counts derived directly from link records —
              not click analytics. Click-level analytics (visits, unique
              visitors, referrers) are introduced in a later milestone; the
              foundation for it (async click-event recording) already exists
              on the redirect path, it just isn't surfaced here yet. */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {STAT_CARDS.map(({ key, label, icon: Icon }) => (
              <Card key={key}>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="rounded-md bg-muted p-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold tabular-nums">
                      {data[key]}
                    </p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent links</CardTitle>
              <CardDescription>
                The 5 most recently created links in this workspace.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.recentLinks.length === 0 ? (
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
                  {data.recentLinks.map((link) => (
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
                      <Badge
                        variant={
                          link.status === 'ACTIVE'
                            ? 'success'
                            : link.status === 'PAUSED'
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        {link.status.charAt(0) +
                          link.status.slice(1).toLowerCase()}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
