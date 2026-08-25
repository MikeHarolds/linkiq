import { ApiPropertyOptional } from '@nestjs/swagger';
import { EmailLogStatus, EmailLogType } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryEmailLogsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: EmailLogStatus })
  @IsOptional()
  @IsEnum(EmailLogStatus)
  status?: EmailLogStatus;

  @ApiPropertyOptional({ enum: EmailLogType })
  @IsOptional()
  @IsEnum(EmailLogType)
  type?: EmailLogType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recipientEmail?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 — inclusive lower bound on createdAt',
  })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 — inclusive upper bound on createdAt',
  })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}
