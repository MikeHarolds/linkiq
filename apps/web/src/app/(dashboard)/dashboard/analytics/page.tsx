'use client';

import {
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
import * as React from 'react';

import {
  AnalyticsEmptyState,
  AnalyticsErrorState,
  AnalyticsLoadingState,
  MetricCard,
} from '@/components/analytics/analytics-states';
import { BreakdownDonutChart } from '@/components/analytics/breakdown-donut-chart';
import { CampaignUtmSection } from '@/components/analytics/campaign-utm-section';
import {
  type DateRangeValue,
  DateRangePicker,
} from '@/components/analytics/date-range-picker';
import { TimeSeriesChart } from '@/components/analytics/time-series-chart';
import { DashboardPageHeader } from '@/components/dashboard/dashboard-page-header';
import {
  getDevices,
  getGeography,
  getOverview,
  getReferrers,
  getTimeseries,
  getTopLinks,
} from '@/lib/analytics-api';
import { ApiError, useAuth } from '@/providers/auth-provider';

export default function AnalyticsDashboardPage() {
  const { currentWorkspaceId } = useAuth();
  const [dateRange, setDateRange] = React.useState<DateRangeValue>({
    range: '7d',
  });

  const queryParams = {
    range: dateRange.range,
    from: dateRange.from,
    to: dateRange.to,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const isCustomIncomplete =
    dateRange.range === 'custom' && (!dateRange.from || !dateRange.to);
  const enabled = Boolean(currentWorkspaceId) && !isCustomIncomplete;

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

  const referrers = useQuery({
    queryKey: ['analytics', 'referrers', currentWorkspaceId, queryParams],
    queryFn: () => getReferrers(currentWorkspaceId!, queryParams),
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

  const topLinks = useQuery({
    queryKey: ['analytics', 'top-links', currentWorkspaceId, queryParams],
    queryFn: () => getTopLinks(currentWorkspaceId!, queryParams),
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
      <DashboardPageHeader
        title="Analytics"
        description="Traffic and engagement across your links."
        actions={<DateRangePicker value={dateRange} onChange={setDateRange} />}
      />

      {/* Summary cards */}
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
            label="Human traffic"
            value={overview.data.humanClicks}
            icon={Globe2}
          />
          <MetricCard
            label="Bot traffic"
            value={overview.data.botClicks}
            icon={Bot}
          />
        </div>
      ) : null}

      {/* Clicks over time */}
      <Card>
        <CardHeader>
          <CardTitle>Clicks over time</CardTitle>
        </CardHeader>
        <CardContent>
          {timeseries.isLoading ? (
            <AnalyticsLoadingState />
          ) : timeseries.isError ? (
            <AnalyticsErrorState message="Failed to load time-series data." />
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Traffic sources</CardTitle>
          </CardHeader>
          <CardContent>
            {referrers.isLoading ? (
              <AnalyticsLoadingState />
            ) : (
              <BreakdownDonutChart
                data={(referrers.data ?? []).map((r) => ({
                  label: r.domain,
                  value: r.clicks,
                }))}
                emptyMessage="No referrer data yet."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Device distribution</CardTitle>
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
                emptyMessage="No device data yet."
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top links</CardTitle>
          </CardHeader>
          <CardContent>
            {topLinks.isLoading ? (
              <AnalyticsLoadingState />
            ) : !topLinks.data || topLinks.data.length === 0 ? (
              <AnalyticsEmptyState message="No link clicks yet." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Link</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topLinks.data.map((link) => (
                    <TableRow key={link.linkId}>
                      <TableCell className="max-w-[220px] truncate">
                        {link.title ?? link.shortCode}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-primary">
                        {link.clicks.toLocaleString()}
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
      </div>

      <CampaignUtmSection
        workspaceId={currentWorkspaceId}
        queryParams={queryParams}
      />
    </div>
  );
}
