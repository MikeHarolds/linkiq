'use client';

import type { AnalyticsRange } from '@linkiq/types';
import { Button, Input } from '@linkiq/ui';
import * as React from 'react';

const RANGE_OPTIONS: { label: string; value: AnalyticsRange }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last 90 days', value: '90d' },
  { label: 'Custom', value: 'custom' },
];

export interface DateRangeValue {
  range: AnalyticsRange;
  from?: string;
  to?: string;
}

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {RANGE_OPTIONS.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant={value.range === option.value ? 'default' : 'outline'}
          onClick={() => onChange({ ...value, range: option.value })}
        >
          {option.label}
        </Button>
      ))}
      {value.range === 'custom' && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="From date"
            value={value.from?.slice(0, 10) ?? ''}
            onChange={(e) =>
              onChange({
                ...value,
                from: e.target.value
                  ? `${e.target.value}T00:00:00.000Z`
                  : undefined,
              })
            }
            className="w-40"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label="To date"
            value={value.to?.slice(0, 10) ?? ''}
            onChange={(e) =>
              onChange({
                ...value,
                to: e.target.value
                  ? `${e.target.value}T23:59:59.999Z`
                  : undefined,
              })
            }
            className="w-40"
          />
        </div>
      )}
    </div>
  );
}
