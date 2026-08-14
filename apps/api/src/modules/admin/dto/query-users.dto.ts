import { ApiPropertyOptional } from '@nestjs/swagger';
import { GlobalRole } from '@prisma/client';
import {
  IsBooleanString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryUsersDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Matches against email/first/last name (case-insensitive).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: GlobalRole })
  @IsOptional()
  @IsEnum(GlobalRole)
  globalRole?: GlobalRole;

  @ApiPropertyOptional({
    description: '"true" or "false" — filter by active/suspended.',
  })
  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}
