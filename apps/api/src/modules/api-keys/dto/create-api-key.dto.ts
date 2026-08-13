import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiKeyPermission } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Production Website' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    enum: ApiKeyPermission,
    isArray: true,
    example: ['LINKS_READ', 'LINKS_WRITE'],
    description:
      'Explicit, non-empty set of scopes this key is granted. There is no ' +
      'implicit "all access" default — every key starts with exactly the ' +
      'permissions listed here.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(ApiKeyPermission, { each: true })
  permissions!: ApiKeyPermission[];

  @ApiPropertyOptional({
    example: '2027-01-01T00:00:00.000Z',
    description: 'ISO 8601 timestamp. Omit for a key that never expires.',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
