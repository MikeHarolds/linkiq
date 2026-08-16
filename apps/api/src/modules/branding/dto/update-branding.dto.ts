import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateBrandingDto {
  @ApiPropertyOptional({ example: 'LinkIQ' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  siteName?: string;
}
