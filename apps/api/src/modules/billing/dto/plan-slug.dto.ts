import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** Shared by subscribe and change-plan — both just need to name the
 * target plan by its slug. */
export class PlanSlugDto {
  @ApiProperty({ example: 'professional' })
  @IsString()
  @MinLength(1)
  planSlug!: string;
}
