import { ApiPropertyOptional } from '@nestjs/swagger';
import { BillingInterval, PlanLimitKey } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Sprint 18B — an intentionally large ceiling on a monetary amount
 * (minor units), not a realistic-pricing guess: comfortably under
 * Prisma `Int`'s 32-bit signed range (2,147,483,647) so a value can
 * never silently overflow the column, while still permitting any
 * legitimate price (≈ 9,999,999.99 in a 2-decimal currency). See
 * docs/architecture/billing.md's money-handling notes. */
export const MAX_MONEY_MINOR_UNITS = 999_999_999;

/**
 * Every field optional (partial update) and nothing pre-filled with an
 * invented value — the admin UI only ever submits fields the operator
 * actually changed, mirroring PlansService.UpdatePlanInput exactly. Price/
 * currency ARE editable (a legitimate platform operation) but this DTO
 * never supplies a default for them — see plans.service.ts's docs on why
 * no value here is invented.
 */
export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({
    description: `Smallest currency unit (e.g. kobo, cents) — never a decimal. The admin UI converts a typed decimal amount (e.g. 19.99) to this integer using exact string arithmetic before sending. Max ${MAX_MONEY_MINOR_UNITS.toLocaleString('en-US')}.`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR_UNITS)
  priceAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiPropertyOptional({ enum: BillingInterval })
  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @ApiPropertyOptional({ description: 'null clears the trial.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  trialDays?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  displayOrder?: number;

  @ApiPropertyOptional({
    description: 'The Paystack plan_code for this plan, or null to unset.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  providerPlanId?: string | null;

  @ApiPropertyOptional({
    description:
      'Full replacement limit map, e.g. { "MAX_LINKS": 100, "MONTHLY_CLICKS": null }. null = unlimited.',
    type: 'object',
  })
  @IsOptional()
  @IsObject()
  limits?: Partial<Record<PlanLimitKey, number | null>>;

  @ApiPropertyOptional({
    description:
      "The platform role a workspace's OWNER holds while this plan is effectively active, or null to detach.",
  })
  @IsOptional()
  @IsUUID()
  platformRoleId?: string | null;

  @ApiPropertyOptional({
    description:
      'Sprint 17 — whether this plan appears on the public marketing pricing section.',
  })
  @IsOptional()
  @IsBoolean()
  isFeaturedOnHomepage?: boolean;

  @ApiPropertyOptional({
    description:
      'Sort position among featured plans on the homepage; null = falls back to displayOrder.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  homepageOrder?: number | null;
}
