import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateWorkspaceDto {
  @ApiProperty({ example: 'Marketing Team (EMEA)' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
