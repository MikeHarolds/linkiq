import { PartialType } from '@nestjs/swagger';

import { CreateLandingPageStatDto } from './create-stat.dto';

export class UpdateLandingPageStatDto extends PartialType(CreateLandingPageStatDto) {}
