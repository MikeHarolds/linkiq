import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Raw token from the verification link.' })
  @IsString()
  @MinLength(1)
  token!: string;
}
