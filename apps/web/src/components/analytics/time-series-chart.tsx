'use client';

import type { AnalyticsTimeseriesPointDto } from '@linkiq/types';
import {
  Area,
  AreaChart,
  CartesianGrid,
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
        <AreaChart
          data={chartData}
          margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="clicksFill" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="hsl(var(--primary))"
                stopOpacity={0.28}
              />
              <stop
                offset="100%"
                stopColor="hsl(var(--primary))"
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-border"
            vertical={false}
          />
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
            cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
            contentStyle={{
              backgroundColor: 'hsl(var(--dash-elevated))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 'var(--radius)',
              fontSize: 12,
              boxShadow: '0 8px 24px -8px hsl(0 0% 0% / 0.4)',
            }}
            labelStyle={{
              color: 'hsl(var(--muted-foreground))',
              marginBottom: 4,
            }}
            itemStyle={{ color: 'hsl(var(--foreground))' }}
          />
          <Area
            type="monotone"
            dataKey="clicks"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            fill="url(#clicksFill)"
            dot={false}
            activeDot={{
              r: 4,
              strokeWidth: 2,
              stroke: 'hsl(var(--background))',
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
