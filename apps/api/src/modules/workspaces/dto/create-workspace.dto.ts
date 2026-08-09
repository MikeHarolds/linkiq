import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateWorkspaceDto {
  @ApiProperty({ example: 'Marketing Team' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
