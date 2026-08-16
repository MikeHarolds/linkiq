import { Module } from '@nestjs/common';

import { BillingModule } from '../billing/billing.module';
import { BrandingModule } from '../branding/branding.module';
import { LandingPageModule } from '../landing-page/landing-page.module';

import { PublicController } from './public.controller';

@Module({
  imports: [LandingPageModule, BrandingModule, BillingModule],
  controllers: [PublicController],
})
export class PublicModule {}
