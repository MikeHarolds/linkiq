import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLandingPageFaqDto {
  @ApiProperty({ example: 'What is LinkIQ?' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  question!: string;

  @ApiProperty({ example: 'LinkIQ is a link management platform for modern teams.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  answer!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
