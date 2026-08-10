import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export const ANALYTICS_RANGES = [
  'today',
  'yesterday',
  '7d',
  '30d',
  '90d',
  'custom',
] as const;
export type AnalyticsRangeValue = (typeof ANALYTICS_RANGES)[number];

export class AnalyticsQueryDto {
  @ApiPropertyOptional({ description: 'Filter to a single link.' })
  @IsOptional()
  @IsUUID()
  linkId?: string;

  @ApiPropertyOptional({ enum: ANALYTICS_RANGES, default: '7d' })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range: AnalyticsRangeValue = '7d';

  @ApiPropertyOptional({ description: 'Required when range=custom. ISO 8601.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Required when range=custom. ISO 8601.' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    default: 'UTC',
    description:
      'IANA timezone name, e.g. "America/New_York". Affects day-boundary calculations.',
  })
  @IsOptional()
  @IsString()
  timezone: string = 'UTC';

  @ApiPropertyOptional({
    default: false,
    description:
      'Include bot traffic in results. Dashboards default to human-only traffic.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeBots: boolean = false;
}

export class TimeseriesQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({ enum: ['hour', 'day'], default: 'day' })
  @IsOptional()
  @IsIn(['hour', 'day'])
  interval: 'hour' | 'day' = 'day';
}
