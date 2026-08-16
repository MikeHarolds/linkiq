import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PermissionKey } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Slugs no custom role may use — not a security boundary (a PlatformRole
 * can never grant GlobalRole.SUPER_ADMIN no matter its name or slug, see
 * docs/architecture/roles-and-permissions.md), but reserved so an admin
 * can never create a role whose name/slug reads as if it does, which
 * would be confusing in the Users list ("Role: Super Admin, Source:
 * ADMIN_ASSIGNED" sitting right next to the real platform-admin flag). */
export const RESERVED_ROLE_SLUGS = ['super-admin', 'super_admin', 'admin'];

export class CreateRoleDto {
  @ApiProperty({ example: 'Growth Partner' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({
    example: 'growth-partner',
    description: 'Immutable once created — RoleResolutionService and seeded Plans key off it.',
  })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase letters, numbers, and hyphens only' })
  @MinLength(1)
  @MaxLength(50)
  slug!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: PermissionKey, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(PermissionKey, { each: true })
  permissions?: PermissionKey[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
