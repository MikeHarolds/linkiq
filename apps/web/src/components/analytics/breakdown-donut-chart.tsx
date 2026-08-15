'use client';

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

import { AnalyticsEmptyState } from './analytics-states';

// Orange primary for the largest/first slice, then a restrained descent
// through the secondary palette — never a rainbow of unrelated hues.
const COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--dash-highlight))',
  'hsl(215 20% 65%)',
  'hsl(217 19% 45%)',
  'hsl(216 22% 32%)',
  'hsl(215 25% 22%)',
];

interface BreakdownDonutChartProps {
  data: { label: string; value: number }[];
  emptyMessage?: string;
}

export function BreakdownDonutChart({
  data,
  emptyMessage = 'No data for this period yet.',
}: BreakdownDonutChartProps) {
  if (data.length === 0) {
    return <AnalyticsEmptyState message={emptyMessage} />;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            stroke="hsl(var(--card))"
            strokeWidth={2}
          >
            {data.map((entry, index) => (
              <Cell key={entry.label} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--dash-elevated))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 'var(--radius)',
              fontSize: 12,
              boxShadow: '0 8px 24px -8px hsl(0 0% 0% / 0.4)',
            }}
            labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
            itemStyle={{ color: 'hsl(var(--foreground))' }}
          />
          <Legend
            wrapperStyle={{
              fontSize: 12,
              color: 'hsl(var(--muted-foreground))',
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
