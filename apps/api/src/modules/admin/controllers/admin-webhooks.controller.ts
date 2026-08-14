import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { DateRangeDto, resolveDateRange } from '../dto/date-range.dto';
import { QueryDeliveriesAdminDto } from '../dto/query-deliveries-admin.dto';
import { AdminWebhooksService } from '../services/admin-webhooks.service';

/** Never selects secretCiphertext/secretPrefix beyond what
 * WebhooksService's own SAFE_SELECT already exposes — no new
 * secret-bearing query is introduced here. */
@ApiTags('admin-webhooks')
@ApiBearerAuth()
@Controller('admin/webhooks')
@UseGuards(SuperAdminGuard)
export class AdminWebhooksController {
  constructor(private readonly adminWebhooks: AdminWebhooksService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Platform webhook delivery overview (SUPER_ADMIN only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Endpoint/delivery counts, success rate, recent events',
  })
  async getOverview(@Query() query: DateRangeDto) {
    const { from, to } = resolveDateRange(query.range);
    return this.adminWebhooks.getOverview(from, to);
  }

  @Get('endpoints')
  @ApiOperation({
    summary: 'List every webhook endpoint across every workspace',
  })
  async listEndpoints(@Query() query: PaginationDto) {
    return this.adminWebhooks.listEndpoints(query.page, query.pageSize);
  }

  @Get('endpoints/:endpointId/deliveries')
  @ApiOperation({ summary: "Drill into an endpoint's delivery attempts" })
  async listDeliveries(
    @Param('endpointId') endpointId: string,
    @Query() query: QueryDeliveriesAdminDto,
  ) {
    return this.adminWebhooks.listDeliveries(
      endpointId,
      query.page,
      query.pageSize,
      query.status,
    );
  }

  @Get('endpoints/:endpointId/deliveries/:deliveryId')
  @ApiOperation({
    summary:
      'View one delivery attempt: response status, attempt count, failure reason',
  })
  async getDelivery(
    @Param('endpointId') endpointId: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.adminWebhooks.getDelivery(endpointId, deliveryId);
  }

  @Post('endpoints/:endpointId/deliveries/:deliveryId/retry')
  @ApiOperation({
    summary:
      'Retry a failed/exhausted delivery — routes through the existing delivery service',
  })
  async retryDelivery(
    @Param('endpointId') endpointId: string,
    @Param('deliveryId') deliveryId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.adminWebhooks.retryDelivery(
      endpointId,
      deliveryId,
      admin.id,
      ctx,
    );
  }
}
