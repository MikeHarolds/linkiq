import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { IsValidUtmValue } from '../../campaigns/utils/is-valid-utm-value.decorator';

export class CreateLinkSourceDto {
  @ApiProperty({ example: 'WhatsApp Campaign' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    example: 'whatsapp',
    description:
      'Normalized source key (a predefined key, e.g. "whatsapp"/"facebook", or a custom one). This is the value placed in the generated URL\'s utm_source and matched against incoming clicks.',
  })
  @IsString()
  @IsValidUtmValue()
  source!: string;

  @ApiProperty({
    example: 'messaging',
    description:
      'Defaults client-side from the source\'s predefined medium — always overridable.',
  })
  @IsString()
  @IsValidUtmValue()
  medium!: string;

  @ApiPropertyOptional({ example: 'summer_sale' })
  @IsOptional()
  @IsString()
  @IsValidUtmValue()
  campaign?: string;
}
