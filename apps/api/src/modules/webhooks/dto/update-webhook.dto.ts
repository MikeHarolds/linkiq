import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

import { SUBSCRIBABLE_WIRE_NAMES } from '../event-catalog';

export class UpdateWebhookDto {
  @ApiPropertyOptional({ example: 'Production Webhook' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: 'https://example.com/linkiq/webhook' })
  @IsOptional()
  @IsString()
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: 'url must be a valid http or https URL' },
  )
  url?: string;

  @ApiPropertyOptional({ enum: SUBSCRIBABLE_WIRE_NAMES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(SUBSCRIBABLE_WIRE_NAMES, { each: true })
  events?: string[];
}
