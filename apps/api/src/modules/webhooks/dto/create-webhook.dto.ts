import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

import { SUBSCRIBABLE_WIRE_NAMES } from '../event-catalog';

export class CreateWebhookDto {
  @ApiProperty({ example: 'Production Webhook' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'https://example.com/linkiq/webhook' })
  @IsString()
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      // require_tld: false so a local test/dev receiver (e.g.
      // "http://localhost:3000/webhook") passes basic shape validation —
      // WebhookUrlGuard (SSRF protection) is what actually decides
      // whether a given host/IP is allowed to be delivered to, not this
      // syntax check.
      require_tld: false,
    },
    { message: 'url must be a valid http or https URL' },
  )
  url!: string;

  @ApiProperty({
    enum: SUBSCRIBABLE_WIRE_NAMES,
    isArray: true,
    example: ['link.created', 'link.updated', 'link.clicked'],
    description:
      'Explicit, non-empty set of events this endpoint receives. There ' +
      'is no "subscribe to everything" default.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(SUBSCRIBABLE_WIRE_NAMES, { each: true })
  events!: string[];
}
