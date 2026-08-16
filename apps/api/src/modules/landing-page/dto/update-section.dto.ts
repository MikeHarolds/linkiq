import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Every field optional — an admin edit is a partial update against
 * whatever the section already has, mirroring UpdatePlanDto's own
 * "never invent a default for an omitted field" philosophy.
 *
 * CTA URLs are deliberately validated as plain strings, not @IsUrl():
 * the existing landing page already uses in-page anchors ("#pricing")
 * and relative paths ("/register") as CTA targets, both of which
 * @IsUrl() rejects outright. */
export class UpdateLandingPageSectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  eyebrow?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  headline?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  primaryCtaText?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  primaryCtaUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  secondaryCtaText?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  secondaryCtaUrl?: string | null;
}
