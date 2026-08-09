import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

import { IsDestinationUrl } from '../../../common/validators/is-destination-url.decorator';
import { IsValidSlug } from '../../../common/validators/is-valid-slug.decorator';

export class CreateLinkDto {
  @ApiProperty({ example: 'https://example.com/a-very-long-landing-page-url' })
  @IsString()
  @IsDestinationUrl()
  destinationUrl!: string;

  @ApiPropertyOptional({
    example: 'summer-sale',
    description: 'Custom slug. Omit to auto-generate a random short code.',
  })
  @IsOptional()
  @IsString()
  @IsValidSlug()
  slug?: string;

  @ApiPropertyOptional({ example: 'Summer Sale Landing Page' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: 'Promo campaign for the July sale.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    example: '2026-12-31T23:59:59.000Z',
    description: 'ISO 8601 timestamp. Omit for a link that never expires.',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
