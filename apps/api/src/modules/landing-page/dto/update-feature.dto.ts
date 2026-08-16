import { PartialType } from '@nestjs/swagger';

import { CreateLandingPageFeatureDto } from './create-feature.dto';

export class UpdateLandingPageFeatureDto extends PartialType(CreateLandingPageFeatureDto) {}
