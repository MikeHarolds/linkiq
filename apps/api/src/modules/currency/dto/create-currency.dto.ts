import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Adds a new currency to the catalogue (SUPER_ADMIN only). ISO 4217
 * alpha code is required and unique — see Currency's own schema docs
 * for why nothing else in this sprint hardcodes a currency list. */
export class CreateCurrencyDto {
  @ApiProperty({ example: 'NGN', description: 'ISO 4217 alpha code (case-insensitive, normalized to uppercase)' })
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, { message: 'code must be a 3-letter ISO 4217 code, e.g. "NGN"' })
  code!: string;

  @ApiProperty({ example: 'Nigerian Naira' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: '₦' })
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  symbol!: string;

  @ApiPropertyOptional({ example: '566', description: 'ISO 4217 numeric code' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  numericCode?: string;

  @ApiPropertyOptional({ default: 2, minimum: 0, maximum: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4)
  decimalPlaces?: number;

  @ApiPropertyOptional({ example: 'West Africa' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
