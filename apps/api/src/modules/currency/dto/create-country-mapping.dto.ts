import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateCountryMappingDto {
  @ApiProperty({ example: 'NG', description: 'ISO 3166-1 alpha-2 country code' })
  @IsString()
  @Matches(/^[A-Za-z]{2}$/, { message: 'countryCode must be a 2-letter ISO 3166-1 code, e.g. "NG"' })
  countryCode!: string;

  @ApiProperty({ example: 'Nigeria' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  countryName!: string;

  @ApiProperty()
  @IsUUID()
  currencyId!: string;
}
