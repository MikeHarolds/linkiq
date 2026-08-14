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
  MaxLength,
  Min,
} from 'class-validator';

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

  @ApiPropertyOptional({ description: 'Smallest currency unit (cents).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
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
}
