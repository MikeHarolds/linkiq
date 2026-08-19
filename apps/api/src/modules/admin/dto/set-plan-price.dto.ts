import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

import { MAX_MONEY_MINOR_UNITS } from './update-plan.dto';

/**
 * Sets a plan's price in one currency (Sprint 16). Either `amount` is
 * supplied directly (a fixed, admin-typed price) or `useExchangeRate`
 * is true and the amount is derived from the plan's own base price via
 * ExchangeRateService — never both silently combined (see
 * AdminPlansController.setPrice).
 */
export class SetPlanPriceDto {
  @ApiProperty()
  @IsUUID()
  currencyId!: string;

  @ApiPropertyOptional({
    description: `Smallest currency unit — never a decimal. Required unless useExchangeRate is true. Max ${MAX_MONEY_MINOR_UNITS.toLocaleString('en-US')}.`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR_UNITS)
  amount?: number;

  @ApiPropertyOptional({
    default: false,
    description:
      "Derive amount from the plan's base price via ExchangeRateService.convert() instead of using `amount` directly.",
  })
  @IsOptional()
  @IsBoolean()
  useExchangeRate?: boolean;

  @ApiPropertyOptional({
    description: 'The Paystack plan_code for this (plan, currency) pair, if already known. Ignored when syncToProvider is true.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  providerPlanId?: string | null;

  @ApiPropertyOptional({
    default: false,
    description: 'If true and the active BillingProvider supports it, also creates a matching per-currency plan on the provider side.',
  })
  @IsOptional()
  @IsBoolean()
  syncToProvider?: boolean;
}
