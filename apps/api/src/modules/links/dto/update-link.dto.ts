import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { IsDestinationUrl } from '../../../common/validators/is-destination-url.decorator';
import { IsValidUtmValue } from '../../campaigns/utils/is-valid-utm-value.decorator';

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

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Reassign to a different campaign, or pass null to remove the campaign association. Any UTM field not explicitly set in this same request inherits the new campaign's defaults (or clears, if campaignId is set to null).",
  })
  @IsOptional()
  @IsUUID()
  campaignId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Reassign to a different custom domain, or pass null to fall back to the default LinkIQ domain. Must belong to this workspace and be VERIFIED or ACTIVE.',
  })
  @IsOptional()
  @IsUUID()
  customDomainId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @IsValidUtmValue()
  utmSource?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @IsValidUtmValue()
  utmMedium?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @IsValidUtmValue()
  utmCampaign?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @IsValidUtmValue()
  utmTerm?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @IsValidUtmValue()
  utmContent?: string | null;
}
