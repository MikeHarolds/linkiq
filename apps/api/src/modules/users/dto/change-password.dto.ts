import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { Match } from '../../../common/validators/match.decorator';

export class ChangePasswordDto {
  @ApiProperty({ description: "The user's current password." })
  @IsString()
  @MinLength(1)
  currentPassword!: string;

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
  newPassword!: string;

  @ApiProperty({ example: 'NewSecurePass123' })
  @IsString()
  @Match('newPassword')
  newPasswordConfirmation!: string;
}
