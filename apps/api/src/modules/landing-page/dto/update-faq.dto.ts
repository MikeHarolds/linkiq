import { PartialType } from '@nestjs/swagger';

import { CreateLandingPageFaqDto } from './create-faq.dto';

export class UpdateLandingPageFaqDto extends PartialType(CreateLandingPageFaqDto) {}
