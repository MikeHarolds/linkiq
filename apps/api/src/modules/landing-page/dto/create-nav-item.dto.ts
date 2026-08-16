import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LandingPageNavPlacement } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLandingPageNavItemDto {
  @ApiProperty({ enum: LandingPageNavPlacement })
  @IsEnum(LandingPageNavPlacement)
  placement!: LandingPageNavPlacement;

  @ApiProperty({ example: 'Pricing' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  @ApiProperty({
    example: '/#pricing',
    description: 'An in-page anchor ("#pricing"), a relative path ("/register"), or an absolute URL.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  url!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
