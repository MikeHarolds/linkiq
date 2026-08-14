import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryWorkspacesDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Matches against workspace name/slug (case-insensitive).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by the workspace subscription plan slug.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  planSlug?: string;
}
