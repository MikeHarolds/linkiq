import { ApiProperty } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { Match } from '../../../common/validators/match.decorator';

export class RegisterDto {
  @ApiProperty({ example: 'Jane' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ example: 'jane@company.com' })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    example: 'SecurePass123',
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

  @ApiProperty({ example: 'SecurePass123' })
  @IsString()
  @Match('password')
  passwordConfirmation!: string;

  @ApiProperty({
    example: true,
    description: 'Must be true — user must accept the Terms of Service.',
  })
  @IsBoolean()
  @Equals(true, { message: 'terms of service must be accepted' })
  termsAccepted!: boolean;
}
