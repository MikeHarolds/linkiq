import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

import { QueryDomainsDto } from '../../domains/dto/query-domains.dto';

export class QueryDomainsAdminDto extends QueryDomainsDto {
  @ApiPropertyOptional({ description: 'Filter to a single workspace.' })
  @IsOptional()
  @IsUUID()
  workspaceId?: string;
}
