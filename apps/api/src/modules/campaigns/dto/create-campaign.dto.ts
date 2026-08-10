import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { IsValidUtmValue } from '../utils/is-valid-utm-value.decorator';

export class CreateCampaignDto {
  @ApiProperty({ example: '2026 Summer Campaign' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'Summer promotion across social and email.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ example: '2026-06-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-08-31T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    example: 'newsletter',
    description:
      'Default utm_source new links in this campaign inherit unless overridden.',
  })
  @IsOptional()
  @IsString()
  @IsValidUtmValue()
  utmSource?: string;

  @ApiPropertyOptional({ example: 'email' })
  @IsOptional()
  @IsString()
  @IsValidUtmValue()
  utmMedium?: string;

  @ApiPropertyOptional({ example: 'summer_campaign_2026' })
  @IsOptional()
  @IsString()
  @IsValidUtmValue()
  utmCampaign?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsValidUtmValue()
  utmTerm?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsValidUtmValue()
  utmContent?: string;
}
