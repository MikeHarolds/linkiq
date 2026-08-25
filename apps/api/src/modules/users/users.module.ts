import { Module } from '@nestjs/common';

import { CurrencyModule } from '../currency/currency.module';
import { RolesModule } from '../roles/roles.module';

import { ReportPreferenceService } from './report-preference.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [RolesModule, CurrencyModule],
  controllers: [UsersController],
  providers: [UsersService, ReportPreferenceService],
  exports: [UsersService],
})
export class UsersModule {}
