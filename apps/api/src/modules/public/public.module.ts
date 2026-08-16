import { Module } from '@nestjs/common';

import { BillingModule } from '../billing/billing.module';
import { BrandingModule } from '../branding/branding.module';
import { CurrencyModule } from '../currency/currency.module';
import { LandingPageModule } from '../landing-page/landing-page.module';

import { PublicController } from './public.controller';

@Module({
  imports: [LandingPageModule, BrandingModule, BillingModule, CurrencyModule],
  controllers: [PublicController],
})
export class PublicModule {}
