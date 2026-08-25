import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class SendTestEmailDto {
  @ApiProperty()
  @IsEmail()
  to!: string;
}
