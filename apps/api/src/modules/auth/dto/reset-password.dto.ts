import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { Match } from '../../../common/validators/match.decorator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Raw token from the reset link.' })
  @IsString()
  @MinLength(1)
  token!: string;

  @ApiProperty({
    example: 'NewSecurePass123',
    description:
      'Minimum 8 characters, at least one uppercase letter, one lowercase letter, and one number.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  password!: string;

  @ApiProperty({ example: 'NewSecurePass123' })
  @IsString()
  @Match('password')
  passwordConfirmation!: string;
}
