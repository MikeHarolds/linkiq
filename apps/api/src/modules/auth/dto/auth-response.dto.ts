import { ApiProperty } from '@nestjs/swagger';

export class UserProfileDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty({ nullable: true }) avatarUrl!: string | null;
  @ApiProperty({ enum: ['SUPER_ADMIN', 'USER'] }) globalRole!: string;
  @ApiProperty() emailVerified!: boolean;
  @ApiProperty() createdAt!: Date;
}

export class WorkspaceSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ enum: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] })
  role!: string;
}

export class AuthResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() user!: UserProfileDto;
  @ApiProperty({ type: [WorkspaceSummaryDto] })
  workspaces!: WorkspaceSummaryDto[];
}

export class MeResponseDto {
  @ApiProperty() user!: UserProfileDto;
  @ApiProperty({ type: [WorkspaceSummaryDto] })
  workspaces!: WorkspaceSummaryDto[];
}
