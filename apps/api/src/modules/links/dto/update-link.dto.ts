import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

import { IsDestinationUrl } from '../../../common/validators/is-destination-url.decorator';

export class UpdateLinkDto {
  @ApiPropertyOptional({ example: 'https://example.com/updated-destination' })
  @IsOptional()
  @IsString()
  @IsDestinationUrl()
  destinationUrl?: string;

  @ApiPropertyOptional({ example: 'Updated title' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z', nullable: true })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}
