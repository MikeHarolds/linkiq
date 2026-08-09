import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'jane@company.com' })
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
