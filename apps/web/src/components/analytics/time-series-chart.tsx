'use client';

import type { AnalyticsTimeseriesPointDto } from '@linkiq/types';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { AnalyticsEmptyState } from './analytics-states';

interface TimeSeriesChartProps {
  data: AnalyticsTimeseriesPointDto[];
  interval: 'hour' | 'day';
}

function formatBucketLabel(bucket: string, interval: 'hour' | 'day'): string {
  const date = new Date(bucket);
  if (interval === 'hour') {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric' }).format(date);
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function TimeSeriesChart({ data, interval }: TimeSeriesChartProps) {
  if (data.length === 0) {
    return <AnalyticsEmptyState message="No click data for this period yet." />;
  }

  const chartData = data.map((point) => ({
    label: formatBucketLabel(point.bucket, interval),
    clicks: point.clicks,
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 'var(--radius)',
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey="clicks"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
