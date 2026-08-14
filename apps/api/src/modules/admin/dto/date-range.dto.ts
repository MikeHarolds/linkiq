import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const TIME_RANGE_VALUES = ['today', '7d', '30d', '90d'] as const;
export type TimeRangeValue = (typeof TIME_RANGE_VALUES)[number];

export class DateRangeDto {
  @ApiPropertyOptional({ enum: TIME_RANGE_VALUES, default: '7d' })
  @IsOptional()
  @IsIn(TIME_RANGE_VALUES)
  range: TimeRangeValue = '7d';
}

/** Shared "today/7d/30d/90d" resolver — every admin metrics endpoint
 * (overview, API usage, webhook operations) uses the same three
 * windows, per the sprint's explicit time-filter requirement. */
export function resolveDateRange(range: TimeRangeValue): {
  from: Date;
  to: Date;
} {
  const to = new Date();
  const from = new Date(to);
  switch (range) {
    case 'today':
      from.setHours(0, 0, 0, 0);
      break;
    case '7d':
      from.setDate(from.getDate() - 7);
      break;
    case '30d':
      from.setDate(from.getDate() - 30);
      break;
    case '90d':
      from.setDate(from.getDate() - 90);
      break;
  }
  return { from, to };
}
