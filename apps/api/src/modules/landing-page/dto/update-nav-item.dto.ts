import { PartialType } from '@nestjs/swagger';

import { CreateLandingPageNavItemDto } from './create-nav-item.dto';

export class UpdateLandingPageNavItemDto extends PartialType(CreateLandingPageNavItemDto) {}
