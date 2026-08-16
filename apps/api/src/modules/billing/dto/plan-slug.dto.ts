import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

/** Shared by subscribe and change-plan — both just need to name the
 * target plan by its slug. */
export class PlanSlugDto {
  @ApiProperty({ example: 'professional' })
  @IsString()
  @MinLength(1)
  planSlug!: string;

  @ApiPropertyOptional({
    example: 'NGN',
    description:
      'Sprint 16 — which currency to check out in. Omitted = the plan\'s own base currency.',
  })
  @IsOptional()
  @IsString()
  currency?: string;
}
