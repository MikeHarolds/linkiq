import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

import { CreateLinkSourceDto } from './create-link-source.dto';

/** Same fields as creation, all optional, plus isActive — the
 * Deactivate/Activate toggle. linkId is deliberately not part of either
 * DTO: a tracking source's link is fixed at creation time. */
export class UpdateLinkSourceDto extends PartialType(CreateLinkSourceDto) {
  @ApiPropertyOptional({
    description:
      'Deactivating stops this source winning explicit attribution for NEW clicks, without losing its configuration or historical click data.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
