import { Module } from '@nestjs/common';

import { CurrencyModule } from '../currency/currency.module';
import { RolesModule } from '../roles/roles.module';

import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [RolesModule, CurrencyModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
