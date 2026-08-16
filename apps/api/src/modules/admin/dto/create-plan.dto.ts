import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingInterval, PlanLimitKey, PlanTier } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Creates a brand-new plan row. Unlike UpdatePlanDto, `slug` and `tier`
 * ARE settable here — they're only immutable AFTER creation (see
 * PlansService's own docs on why updateForAdmin never touches them).
 */
export class CreatePlanDto {
  @ApiProperty({ example: 'Growth' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    example: 'growth',
    description: 'Immutable once created — other code (checkout, seed data) keys off this.',
  })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase letters, numbers, and hyphens only' })
  @MinLength(1)
  @MaxLength(50)
  slug!: string;

  @ApiProperty({ enum: PlanTier })
  @IsEnum(PlanTier)
  tier!: PlanTier;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ description: 'Smallest currency unit (cents).' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceAmount!: number;

  @ApiPropertyOptional({ default: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiPropertyOptional({ enum: BillingInterval, default: BillingInterval.MONTHLY })
  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  trialDays?: number | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  displayOrder?: number;

  @ApiPropertyOptional({
    description: 'The Paystack plan_code for this plan, if already known. Ignored when syncToProvider is true.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  providerPlanId?: string | null;

  @ApiPropertyOptional({
    description: 'e.g. { "MAX_LINKS": 100, "MONTHLY_CLICKS": null }. null = unlimited. Omitted keys = unlimited (fail-open, see PlanLimit\'s own docs).',
    type: 'object',
  })
  @IsOptional()
  @IsObject()
  limits?: Partial<Record<PlanLimitKey, number | null>>;

  @ApiPropertyOptional({
    description:
      'If true and the active BillingProvider supports it (Paystack does), also creates a matching plan on the provider side. Never fails plan creation if the sync itself fails — see BillingProvider.createProviderPlan.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  syncToProvider?: boolean;
}
