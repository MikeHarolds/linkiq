import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkspaceRole } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, MaxLength } from 'class-validator';

export class InviteMemberDto {
  @ApiProperty({ example: 'colleague@company.com' })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiPropertyOptional({
    enum: WorkspaceRole,
    default: WorkspaceRole.MEMBER,
    description: 'Cannot invite as OWNER — ownership transfers separately.',
  })
  @IsOptional()
  @IsEnum(WorkspaceRole)
  role?: Exclude<WorkspaceRole, 'OWNER'>;
}
