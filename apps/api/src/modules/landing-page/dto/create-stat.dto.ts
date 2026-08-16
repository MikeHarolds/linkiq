import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { LANDING_PAGE_ICON_KEYS } from '../constants';

export class CreateLandingPageStatDto {
  @ApiProperty({ example: 'Fast redirects' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  @ApiPropertyOptional({ example: 'Cached, low-latency' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sublabel?: string | null;

  @ApiProperty({ enum: LANDING_PAGE_ICON_KEYS })
  @IsIn(LANDING_PAGE_ICON_KEYS)
  icon!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
