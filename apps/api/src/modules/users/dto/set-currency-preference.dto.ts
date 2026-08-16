import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SetCurrencyPreferenceDto {
  @ApiProperty({ example: 'NGN' })
  @IsString()
  @MinLength(1)
  currency!: string;
}
