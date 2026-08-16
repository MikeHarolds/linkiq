import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignRoleDto {
  @ApiProperty({ description: 'PlatformRole id to assign as an admin override.' })
  @IsUUID()
  platformRoleId!: string;
}
