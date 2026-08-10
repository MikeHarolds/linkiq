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
import {
  Bot,
  ExternalLink,
  Globe2,
  MousePointerClick,
  QrCode,
  Users,
} from 'lucide-react';
import Link from 'next/link';
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
import { CampaignStatusBadge } from '@/components/campaigns/campaign-status-badge';
import {
  getCampaign,
  getCampaignAnalytics,
  getCampaignLinks,
} from '@/lib/campaigns-api';
import { ApiError, useAuth } from '@/providers/auth-provider';

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id;
  const { currentWorkspaceId } = useAuth();
  const [dateRange, setDateRange] = React.useState<DateRangeValue>({
    range: '30d',
  });

  const queryParams = {
    range: dateRange.range,
    from: dateRange.from,
    to: dateRange.to,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    interval: (dateRange.range === 'today' || dateRange.range === 'yesterday'
      ? 'hour'
      : 'day') as 'hour' | 'day',
  };
  const isCustomIncomplete =
    dateRange.range === 'custom' && (!dateRange.from || !dateRange.to);
  const enabled = Boolean(currentWorkspaceId) && !isCustomIncomplete;

  const campaign = useQuery({
    queryKey: ['campaigns', currentWorkspaceId, campaignId],
    queryFn: () => getCampaign(currentWorkspaceId!, campaignId),
    enabled: Boolean(currentWorkspaceId),
  });

  const links = useQuery({
    queryKey: ['campaigns', 'links', currentWorkspaceId, campaignId],
    queryFn: () => getCampaignLinks(currentWorkspaceId!, campaignId),
    enabled: Boolean(currentWorkspaceId),
  });

  const analytics = useQuery({
    queryKey: [
      'campaigns',
      'analytics',
      currentWorkspaceId,
      campaignId,
      queryParams,
    ],
    queryFn: () =>
      getCampaignAnalytics(currentWorkspaceId!, campaignId, queryParams),
    enabled,
  });

  if (!currentWorkspaceId) {
    return (
      <p className="text-muted-foreground">
        Select a workspace to view this campaign.
      </p>
    );
  }

  if (campaign.isLoading) {
    return <AnalyticsLoadingState label="Loading campaign…" />;
  }

  if (campaign.isError || !campaign.data) {
    return <AnalyticsErrorState message="Failed to load this campaign." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {campaign.data.name}
            </h1>
            <CampaignStatusBadge status={campaign.data.status} />
          </div>
          {campaign.data.description && (
            <p className="mt-1 text-muted-foreground">
              {campaign.data.description}
            </p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDate(campaign.data.startDate)} –{' '}
            {formatDate(campaign.data.endDate)}
          </p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {analytics.isLoading ? (
        <AnalyticsLoadingState />
      ) : analytics.isError ? (
        <AnalyticsErrorState
          message={
            analytics.error instanceof ApiError
              ? analytics.error.message
              : 'Failed to load analytics.'
          }
        />
      ) : analytics.data ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <MetricCard
              label="Links"
              value={links.data?.length ?? 0}
              icon={ExternalLink}
            />
            <MetricCard
              label="Total clicks"
              value={analytics.data.overview.totalClicks}
              icon={MousePointerClick}
            />
            <MetricCard
              label="Unique visitors"
              value={analytics.data.overview.uniqueVisitors}
              icon={Users}
            />
            <MetricCard
              label="Human traffic"
              value={analytics.data.overview.humanClicks}
              icon={Globe2}
            />
            <MetricCard
              label="Bot traffic"
              value={analytics.data.overview.botClicks}
              icon={Bot}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Click trend</CardTitle>
            </CardHeader>
            <CardContent>
              <TimeSeriesChart
                data={analytics.data.clickTrend}
                interval={queryParams.interval}
              />
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Traffic sources</CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownDonutChart
                  data={analytics.data.topSources
                    .filter((s) => s.value !== 'none')
                    .map((s) => ({ label: s.value, value: s.clicks }))}
                  emptyMessage="No UTM source data yet."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Device distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownDonutChart
                  data={analytics.data.devices.map((d) => ({
                    label: d.value,
                    value: d.clicks,
                  }))}
                  emptyMessage="No device data yet."
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Top links</CardTitle>
              </CardHeader>
              <CardContent>
                {analytics.data.topLinks.length === 0 ? (
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
                      {analytics.data.topLinks.map((link) => (
                        <TableRow key={link.linkId}>
                          <TableCell className="max-w-[220px] truncate">
                            {link.title ?? link.shortCode}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {link.clicks}
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
                {analytics.data.topCountries.length === 0 ? (
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
                      {analytics.data.topCountries.map((row) => (
                        <TableRow key={row.value}>
                          <TableCell>{row.value}</TableCell>
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
        </>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Links in this campaign</CardTitle>
        </CardHeader>
        <CardContent>
          {links.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading links…</p>
          ) : !links.data || links.data.length === 0 ? (
            <AnalyticsEmptyState message="No links assigned to this campaign yet. Create a link and select this campaign, or edit an existing link to assign it." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Short URL</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>QR codes</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.data.map((link) => (
                  <TableRow key={link.id}>
                    <TableCell>
                      <code className="text-sm">{link.shortCode}</code>
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-muted-foreground">
                      {link.destinationUrl}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          link.status === 'ACTIVE' ? 'success' : 'secondary'
                        }
                      >
                        {link.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {link.qrCodes.length > 0 ? (
                        <span className="flex items-center gap-1 text-sm text-muted-foreground">
                          <QrCode className="h-3.5 w-3.5" />
                          {link.qrCodes.length}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/dashboard/links/${link.id}`}
                        className="text-sm text-primary hover:underline"
                      >
                        Open
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
