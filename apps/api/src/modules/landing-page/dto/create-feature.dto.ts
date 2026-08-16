import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { LANDING_PAGE_ICON_KEYS } from '../constants';

export class CreateLandingPageFeatureDto {
  @ApiProperty({ example: 'Shorten' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  title!: string;

  @ApiProperty({ example: 'Turn any URL into a clean, brandable link in milliseconds.' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description!: string;

  @ApiProperty({ enum: LANDING_PAGE_ICON_KEYS })
  @IsIn(LANDING_PAGE_ICON_KEYS)
  icon!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
