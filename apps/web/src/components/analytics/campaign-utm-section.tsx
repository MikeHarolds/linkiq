'use client';

import type { AnalyticsQueryParams } from '@linkiq/types';
import {
  Button,
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
import { ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { getTopCampaigns, getUtmBreakdown } from '@/lib/analytics-api';

import { AnalyticsEmptyState, AnalyticsLoadingState } from './analytics-states';

interface CampaignUtmSectionProps {
  workspaceId: string;
  queryParams: AnalyticsQueryParams;
}

const UTM_FIELDS = [
  { field: 'source' as const, label: 'Source' },
  { field: 'medium' as const, label: 'Medium' },
  { field: 'term' as const, label: 'Term' },
  { field: 'content' as const, label: 'Content' },
];

/**
 * Collapsed by default — campaign/UTM breakdowns are valuable for teams
 * running tracked campaigns but irrelevant noise for anyone who isn't,
 * so this stays out of the way until explicitly opened (Sprint 5 spec:
 * "Do not overwhelm the dashboard. Use progressive disclosure").
 */
export function CampaignUtmSection({
  workspaceId,
  queryParams,
}: CampaignUtmSectionProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [utmField, setUtmField] =
    React.useState<(typeof UTM_FIELDS)[number]['field']>('source');

  const campaigns = useQuery({
    queryKey: ['analytics', 'campaigns', workspaceId, queryParams],
    queryFn: () => getTopCampaigns(workspaceId, queryParams),
    enabled: expanded,
  });

  const utm = useQuery({
    queryKey: ['analytics', 'utm', utmField, workspaceId, queryParams],
    queryFn: () => getUtmBreakdown(workspaceId, utmField, queryParams),
    enabled: expanded,
  });

  return (
    <Card>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between p-6 text-left"
      >
        <div>
          <CardTitle className="text-base">Campaigns &amp; UTM</CardTitle>
          <p className="mt-1 text-sm font-normal text-muted-foreground">
            Clicks broken down by campaign and tracking parameters
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      {expanded && (
        <CardContent className="grid gap-6 pt-0 lg:grid-cols-2">
          <div>
            <CardHeader className="px-0 pt-0">
              <CardTitle className="text-sm">By campaign</CardTitle>
            </CardHeader>
            {campaigns.isLoading ? (
              <AnalyticsLoadingState />
            ) : !campaigns.data || campaigns.data.length === 0 ? (
              <AnalyticsEmptyState message="No campaign traffic yet." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.data.map((row) => (
                    <TableRow key={row.campaignId ?? 'none'}>
                      <TableCell>
                        {row.campaignId ? (
                          <Link
                            href={`/dashboard/campaigns/${row.campaignId}`}
                            className="hover:underline"
                          >
                            {row.name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">
                            {row.name}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.clicks}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <div>
            <CardHeader className="flex flex-row items-center justify-between px-0 pt-0">
              <CardTitle className="text-sm">By UTM field</CardTitle>
              <div className="flex gap-1">
                {UTM_FIELDS.map((f) => (
                  <Button
                    key={f.field}
                    size="sm"
                    variant={utmField === f.field ? 'default' : 'outline'}
                    onClick={() => setUtmField(f.field)}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
            </CardHeader>
            {utm.isLoading ? (
              <AnalyticsLoadingState />
            ) : !utm.data ||
              utm.data.filter((r) => r.value !== 'none').length === 0 ? (
              <AnalyticsEmptyState message="No data for this field yet." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Value</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {utm.data
                    .filter((row) => row.value !== 'none')
                    .map((row) => (
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
          </div>
        </CardContent>
      )}
    </Card>
  );
}
