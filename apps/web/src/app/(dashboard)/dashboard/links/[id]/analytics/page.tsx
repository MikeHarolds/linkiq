'use client';

import {
  Badge,
  Card,
  CardContent,
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
import { Bot, Globe2, MousePointerClick, Users } from 'lucide-react';
import { useParams } from 'next/navigation';
import * as React from 'react';

import {
  AnalyticsEmptyState,
  AnalyticsErrorState,
  AnalyticsLoadingState,
  MetricCard,
} from '@/components/analytics/analytics-states';
import { BreakdownDonutChart } from '@/components/analytics/breakdown-donut-chart';
import {
  type DateRangeValue,
  DateRangePicker,
} from '@/components/analytics/date-range-picker';
import { TimeSeriesChart } from '@/components/analytics/time-series-chart';
import {
  getBrowsers,
  getDevices,
  getGeography,
  getOperatingSystems,
  getOverview,
  getReferrers,
  getSourceBreakdown,
  getTimeseries,
} from '@/lib/analytics-api';
import { getLink } from '@/lib/links-api';
import { ApiError, useAuth } from '@/providers/auth-provider';

/** Labels the tier that won attribution for a row (see
 * resolveAttribution on the API side) — 'campaign' means an explicit
 * LinkSource matched; everything else is a lower-confidence signal. */
function attributionBadge(type: 'campaign' | 'utm' | 'referrer' | 'direct'): {
  label: string;
  variant: 'success' | 'secondary' | 'outline';
} {
  switch (type) {
    case 'campaign':
      return { label: 'Campaign', variant: 'success' };
    case 'utm':
      return { label: 'UTM', variant: 'secondary' };
    case 'referrer':
      return { label: 'Detected referrer', variant: 'outline' };
    default:
      return { label: 'Direct', variant: 'outline' };
  }
}

export default function LinkAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const linkId = params.id;
  const { currentWorkspaceId } = useAuth();
  const [dateRange, setDateRange] = React.useState<DateRangeValue>({
    range: '7d',
  });

  const queryParams = {
    linkId,
    range: dateRange.range,
    from: dateRange.from,
    to: dateRange.to,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const isCustomIncomplete =
    dateRange.range === 'custom' && (!dateRange.from || !dateRange.to);
  const enabled = Boolean(currentWorkspaceId) && !isCustomIncomplete;

  const link = useQuery({
    queryKey: ['links', currentWorkspaceId, linkId],
    queryFn: () => getLink(currentWorkspaceId!, linkId),
    enabled: Boolean(currentWorkspaceId),
  });

  const overview = useQuery({
    queryKey: ['analytics', 'overview', currentWorkspaceId, queryParams],
    queryFn: () => getOverview(currentWorkspaceId!, queryParams),
    enabled,
  });

  const timeseries = useQuery({
    queryKey: ['analytics', 'timeseries', currentWorkspaceId, queryParams],
    queryFn: () =>
      getTimeseries(currentWorkspaceId!, {
        ...queryParams,
        interval:
          dateRange.range === 'today' || dateRange.range === 'yesterday'
            ? 'hour'
            : 'day',
      }),
    enabled,
  });

  const geography = useQuery({
    queryKey: ['analytics', 'geography', currentWorkspaceId, queryParams],
    queryFn: () => getGeography(currentWorkspaceId!, queryParams),
    enabled,
  });

  const devices = useQuery({
    queryKey: ['analytics', 'devices', currentWorkspaceId, queryParams],
    queryFn: () => getDevices(currentWorkspaceId!, queryParams),
    enabled,
  });

  const browsers = useQuery({
    queryKey: ['analytics', 'browsers', currentWorkspaceId, queryParams],
    queryFn: () => getBrowsers(currentWorkspaceId!, queryParams),
    enabled,
  });

  const os = useQuery({
    queryKey: ['analytics', 'os', currentWorkspaceId, queryParams],
    queryFn: () => getOperatingSystems(currentWorkspaceId!, queryParams),
    enabled,
  });

  const referrers = useQuery({
    queryKey: ['analytics', 'referrers', currentWorkspaceId, queryParams],
    queryFn: () => getReferrers(currentWorkspaceId!, queryParams),
    enabled,
  });

  const sources = useQuery({
    queryKey: ['analytics', 'sources', currentWorkspaceId, queryParams],
    queryFn: () => getSourceBreakdown(currentWorkspaceId!, queryParams),
    enabled,
  });

  if (!currentWorkspaceId) {
    return (
      <p className="text-muted-foreground">
        Select a workspace to view analytics.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {link.data?.title ?? link.data?.shortCode ?? 'Link analytics'}
          </h1>
          {link.data && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <code className="text-sm">{link.data.shortCode}</code>
              <Badge
                variant={
                  link.data.status === 'ACTIVE' ? 'success' : 'secondary'
                }
              >
                {link.data.status}
              </Badge>
            </div>
          )}
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {overview.isLoading ? (
        <AnalyticsLoadingState />
      ) : overview.isError ? (
        <AnalyticsErrorState
          message={
            overview.error instanceof ApiError
              ? overview.error.message
              : 'Failed to load overview.'
          }
        />
      ) : overview.data ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard
            label="Total clicks"
            value={overview.data.totalClicks}
            icon={MousePointerClick}
          />
          <MetricCard
            label="Unique visitors"
            value={overview.data.uniqueVisitors}
            icon={Users}
          />
          <MetricCard
            label="Human clicks"
            value={overview.data.humanClicks}
            icon={Globe2}
          />
          <MetricCard
            label="Bot clicks"
            value={overview.data.botClicks}
            icon={Bot}
          />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Click trend</CardTitle>
        </CardHeader>
        <CardContent>
          {timeseries.isLoading ? (
            <AnalyticsLoadingState />
          ) : (
            <TimeSeriesChart
              data={timeseries.data ?? []}
              interval={
                dateRange.range === 'today' || dateRange.range === 'yesterday'
                  ? 'hour'
                  : 'day'
              }
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Devices</CardTitle>
          </CardHeader>
          <CardContent>
            {devices.isLoading ? (
              <AnalyticsLoadingState />
            ) : (
              <BreakdownDonutChart
                data={(devices.data ?? []).map((d) => ({
                  label: d.value,
                  value: d.clicks,
                }))}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Browsers</CardTitle>
          </CardHeader>
          <CardContent>
            {browsers.isLoading ? (
              <AnalyticsLoadingState />
            ) : (
              <BreakdownDonutChart
                data={(browsers.data ?? []).map((b) => ({
                  label: b.value,
                  value: b.clicks,
                }))}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Operating systems</CardTitle>
          </CardHeader>
          <CardContent>
            {os.isLoading ? (
              <AnalyticsLoadingState />
            ) : (
              <BreakdownDonutChart
                data={(os.data ?? []).map((o) => ({
                  label: o.value,
                  value: o.clicks,
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top countries</CardTitle>
          </CardHeader>
          <CardContent>
            {geography.isLoading ? (
              <AnalyticsLoadingState />
            ) : !geography.data || geography.data.countries.length === 0 ? (
              <AnalyticsEmptyState message="No geographic data yet." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Country</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {geography.data.countries.map((row) => (
                    <TableRow key={row.country}>
                      <TableCell>{row.country}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.clicks}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Referrers</CardTitle>
          </CardHeader>
          <CardContent>
            {referrers.isLoading ? (
              <AnalyticsLoadingState />
            ) : !referrers.data || referrers.data.length === 0 ? (
              <AnalyticsEmptyState message="No referrer data yet." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {referrers.data.map((row) => (
                    <TableRow key={row.domain}>
                      <TableCell>{row.domain}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.clicks}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Traffic Sources</CardTitle>
        </CardHeader>
        <CardContent>
          {sources.isLoading ? (
            <AnalyticsLoadingState />
          ) : !sources.data || sources.data.length === 0 ? (
            <AnalyticsEmptyState message="No attributed traffic yet." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Medium</TableHead>
                  <TableHead>Attribution</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.data.map((row) => {
                  const badge = attributionBadge(row.attributionType);
                  return (
                    <TableRow key={`${row.source}-${row.attributionType}`}>
                      <TableCell>{row.source}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.medium ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.clicks}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
