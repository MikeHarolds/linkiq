import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import {
  Ctx,
  type RequestContext,
} from '../../../common/decorators/request-context.decorator';
import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { SendTestEmailDto } from '../../email/dto/send-test-email.dto';
import { UpdateEmailConfigDto } from '../../email/dto/update-email-config.dto';
import { DateRangeDto } from '../dto/date-range.dto';
import { QueryEmailLogsDto } from '../dto/query-email-logs.dto';
import { AdminEmailService } from '../services/admin-email.service';

/**
 * Admin → Settings → Email (§4/§13/§14/§17 of the Sprint 20 spec) —
 * SUPER_ADMIN only. Secrets (resendApiKeyCiphertext/
 * smtpPasswordCiphertext) never leave EmailConfigService.getMasked() —
 * every response here goes through that method, never a raw Prisma read.
 */
@ApiTags('admin-email')
@ApiBearerAuth()
@Controller('admin/email')
@UseGuards(SuperAdminGuard)
export class AdminEmailController {
  constructor(private readonly adminEmail: AdminEmailService) {}

  @Get('config')
  @ApiOperation({
    summary: 'Current email configuration — secrets are never returned',
  })
  getConfig() {
    return this.adminEmail.getConfig();
  }

  @Patch('config')
  @ApiOperation({
    summary: 'Update email configuration',
    description:
      'Omit resendApiKey/smtpPassword to leave the currently-stored secret unchanged. Provide a new value to replace it.',
  })
  updateConfig(
    @Body() dto: UpdateEmailConfigDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.adminEmail.updateConfig(dto, admin.id, ctx);
  }

  @Post('test-connection')
  @ApiOperation({
    summary: 'Verify the configured provider actually authenticates',
  })
  @ApiResponse({ status: 200, description: 'Connection test result' })
  testConnection() {
    return this.adminEmail.testConnection();
  }

  @Post('send-test')
  @ApiOperation({
    summary: 'Send a real test email through the configured provider',
  })
  async sendTest(@Body() dto: SendTestEmailDto) {
    await this.adminEmail.sendTestEmail(dto.to);
    return { message: `Test email queued for ${dto.to}` };
  }

  @Get('logs')
  @ApiOperation({
    summary: 'Email delivery log — filterable by status/type/date/recipient',
  })
  listLogs(@Query() query: QueryEmailLogsDto) {
    return this.adminEmail.listLogs(query);
  }

  @Get('stats')
  @ApiOperation({
    summary:
      'Sent/failed/queued/skipped counts and success rate over a date range',
  })
  getStats(@Query() query: DateRangeDto) {
    return this.adminEmail.getStats(query);
  }
}
