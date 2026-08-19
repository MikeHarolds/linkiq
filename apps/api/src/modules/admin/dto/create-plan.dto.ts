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
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { MAX_MONEY_MINOR_UNITS } from './update-plan.dto';

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
    description:
      'Immutable once created — other code (checkout, seed data) keys off this.',
  })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must be lowercase letters, numbers, and hyphens only',
  })
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

  @ApiProperty({
    description: `Smallest currency unit (e.g. kobo, cents) — never a decimal. The admin UI converts a typed decimal amount (e.g. 19.99) to this integer using exact string arithmetic before sending. Max ${MAX_MONEY_MINOR_UNITS.toLocaleString('en-US')}.`,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR_UNITS)
  priceAmount!: number;

  @ApiPropertyOptional({
    default: 'NGN',
    description: "Platform default is NGN — see docs/architecture/currency.md.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiPropertyOptional({
    enum: BillingInterval,
    default: BillingInterval.MONTHLY,
  })
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
    description:
      'The Paystack plan_code for this plan, if already known. Ignored when syncToProvider is true.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  providerPlanId?: string | null;

  @ApiPropertyOptional({
    description:
      'e.g. { "MAX_LINKS": 100, "MONTHLY_CLICKS": null }. null = unlimited. Omitted keys = unlimited (fail-open, see PlanLimit\'s own docs).',
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

  @ApiPropertyOptional({
    description:
      "The platform role a workspace's OWNER holds while this plan is effectively active on a workspace they own. Optional — an internal/custom plan can have no role, in which case subscribing to it never changes anyone's platformRole. Validated server-side to be an existing, active, non-reserved-slug role — see PlansService.create/updateForAdmin.",
  })
  @IsOptional()
  @IsUUID()
  platformRoleId?: string | null;

  @ApiPropertyOptional({
    default: false,
    description:
      'Sprint 17 — whether this plan appears on the public marketing pricing section.',
  })
  @IsOptional()
  @IsBoolean()
  isFeaturedOnHomepage?: boolean;

  @ApiPropertyOptional({
    description:
      'Sort position among featured plans on the homepage; omitted falls back to displayOrder.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  homepageOrder?: number | null;
}
