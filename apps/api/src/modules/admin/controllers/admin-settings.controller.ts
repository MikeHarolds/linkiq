import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import { AdminSettingsService } from '../services/admin-settings.service';

/**
 * Platform configuration visibility — SUPER_ADMIN only. Read-only; see
 * admin-settings.service.ts's docs for why no settings-mutation
 * endpoint exists this sprint. PAYSTACK_SECRET_KEY is never returned in
 * any form — only booleans/classifications derived from it server-side.
 */
@ApiTags('admin-settings')
@ApiBearerAuth()
@Controller('admin/settings')
@UseGuards(SuperAdminGuard)
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Platform configuration snapshot (SUPER_ADMIN only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Billing provider, webhook config, domain verification mode',
  })
  getPlatformSettings() {
    return this.settings.getPlatformSettings();
  }

  @Get('payments')
  @ApiOperation({
    summary:
      'Payment provider configuration status — never returns the secret key',
  })
  getPaymentsSettings() {
    return this.settings.getPaymentsSettings();
  }

  @Post('payments/test-connection')
  @ApiOperation({
    summary: 'Verify the configured Paystack secret key actually authenticates',
  })
  testPaystackConnection() {
    return this.settings.testPaystackConnection();
  }
}
