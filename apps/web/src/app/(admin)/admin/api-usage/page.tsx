'use client';

import type { TimeRangeValue } from '@linkiq/types';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@linkiq/ui';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { getApiUsageOverview } from '@/lib/admin-api';
import { ApiError } from '@/providers/auth-provider';

const RANGE_OPTIONS: { label: string; value: TimeRangeValue }[] = [
  { label: 'Today', value: 'today' },
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
];

export default function AdminApiUsagePage() {
  const [range, setRange] = React.useState<TimeRangeValue>('7d');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'api-usage', range],
    queryFn: () => getApiUsageOverview(range),
  });

  return (
    <div>
      <AdminPageHeader
        title="API Usage"
        description="Platform-wide developer API traffic. Key secrets are never shown — only safe metadata."
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
          Loading API usage…
        </div>
      )}

      {isError && (
        <div role="alert" className="py-12 text-center text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load API usage.'}
        </div>
      )}

      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Requests (range)</CardDescription>
                <CardTitle className="text-2xl">{data.totalRequests.toLocaleString()}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Failed requests (4xx/5xx)</CardDescription>
                <CardTitle className="text-2xl">{data.failedRequests.toLocaleString()}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Active API keys</CardDescription>
                <CardTitle className="text-2xl">{data.activeApiKeys}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top workspaces by request volume</CardTitle>
            </CardHeader>
            <CardContent>
              {data.topWorkspaces.length === 0 ? (
                <p className="text-sm text-muted-foreground">No API traffic in this range.</p>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Workspace</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.topWorkspaces.map((w) => (
                        <TableRow key={w.workspaceId}>
                          <TableCell>{w.workspaceName}</TableCell>
                          <TableCell className="text-right">{w.requests.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Requests over time</CardTitle>
            </CardHeader>
            <CardContent>
              {data.requestsOverTime.length === 0 ? (
                <p className="text-sm text-muted-foreground">No API traffic in this range.</p>
              ) : (
                <div className="space-y-1">
                  {data.requestsOverTime.map((point) => (
                    <div key={point.date} className="flex items-center gap-3 text-sm">
                      <span className="w-24 text-muted-foreground">{point.date}</span>
                      <div className="h-2 flex-1 rounded bg-muted">
                        <div
                          className="h-2 rounded bg-primary"
                          style={{
                            width: `${Math.min(
                              100,
                              (point.count / Math.max(...data.requestsOverTime.map((p) => p.count), 1)) * 100,
                            )}%`,
                          }}
                        />
                      </div>
                      <span className="w-16 text-right text-muted-foreground">{point.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
