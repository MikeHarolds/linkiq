import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { WorkspaceRole } from '@prisma/client';

import { ApiPermission } from '../../common/decorators/api-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  Ctx,
  type RequestContext,
} from '../../common/decorators/request-context.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

import { CreateWebhookDto } from './dto/create-webhook.dto';
import { QueryDeliveriesDto } from './dto/query-deliveries.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { WebhooksService } from './webhooks.service';

/**
 * Nested under /workspaces/:workspaceId/webhooks, matching
 * domains.controller.ts's precedent for workspace sub-resources.
 *
 * Unlike Links/Campaigns/Domains (VIEWER read, MEMBER mutate), every
 * mutation here is ADMIN+ — a webhook signing secret is a credential,
 * matching Sprint 7/8's precedent that credential management (billing,
 * API keys) is ADMIN/OWNER only. VIEWER can still read endpoints and
 * delivery history.
 */
@ApiTags('webhooks')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/webhooks')
@UseGuards(WorkspaceRolesGuard)
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @Roles(WorkspaceRole.ADMIN)
  @ApiPermission('WEBHOOKS_WRITE')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a webhook endpoint (ADMIN or OWNER)' })
  @ApiResponse({
    status: 201,
    description: 'Endpoint created; the signing secret is returned once',
  })
  async create(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Body() dto: CreateWebhookDto,
  ) {
    return this.webhooksService.create(workspaceId, user.id, dto, ctx);
  }

  @Get()
  @Roles(WorkspaceRole.VIEWER)
  @ApiPermission('WEBHOOKS_READ')
  @ApiOperation({ summary: 'List webhook endpoints in the workspace' })
  async findAll(@Param('workspaceId') workspaceId: string) {
    return this.webhooksService.findAll(workspaceId);
  }

  @Get(':id')
  @Roles(WorkspaceRole.VIEWER)
  @ApiPermission('WEBHOOKS_READ')
  @ApiOperation({ summary: 'Get a single webhook endpoint' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('workspaceId') workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooksService.findByIdOrThrow(workspaceId, id);
  }

  @Patch(':id')
  @Roles(WorkspaceRole.ADMIN)
  @ApiPermission('WEBHOOKS_WRITE')
  @ApiOperation({ summary: 'Update a webhook endpoint (ADMIN or OWNER)' })
  async update(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooksService.update(workspaceId, id, user.id, dto, ctx);
  }

  @Delete(':id')
  @Roles(WorkspaceRole.ADMIN)
  @ApiPermission('WEBHOOKS_WRITE')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a webhook endpoint (ADMIN or OWNER)' })
  async remove(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.webhooksService.softDelete(workspaceId, id, user.id, ctx);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @Roles(WorkspaceRole.ADMIN)
  @ApiPermission('WEBHOOKS_WRITE')
  @ApiOperation({ summary: 'Pause a webhook endpoint (ADMIN or OWNER)' })
  async pause(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooksService.pause(workspaceId, id, user.id, ctx);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Roles(WorkspaceRole.ADMIN)
  @ApiPermission('WEBHOOKS_WRITE')
  @ApiOperation({
    summary: 'Activate a paused or disabled webhook endpoint (ADMIN or OWNER)',
    description: 'Also resets the consecutive-failure counter.',
  })
  async activate(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooksService.activate(workspaceId, id, user.id, ctx);
  }

  @Post(':id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @Roles(WorkspaceRole.ADMIN)
  @ApiPermission('WEBHOOKS_WRITE')
  @ApiOperation({
    summary: "Rotate a webhook endpoint's signing secret (ADMIN or OWNER)",
    description:
      'The previous secret stops verifying immediately. The new secret is returned once.',
  })
  async rotateSecret(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooksService.rotateSecret(workspaceId, id, user.id, ctx);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(WorkspaceRole.ADMIN)
  @ApiPermission('WEBHOOKS_WRITE')
  @ApiOperation({
    summary: 'Send a test event to this endpoint (ADMIN or OWNER)',
    description:
      'Delivered asynchronously via the same signing/delivery infra as real events. Always type "webhook.test" — never presented as a real domain event.',
  })
  async test(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooksService.sendTestEvent(workspaceId, id, user.id);
  }

  @Get(':id/deliveries')
  @Roles(WorkspaceRole.VIEWER)
  @ApiPermission('WEBHOOKS_READ')
  @ApiOperation({ summary: 'List delivery history for a webhook endpoint' })
  async listDeliveries(
    @Param('workspaceId') workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryDeliveriesDto,
  ) {
    return this.webhooksService.listDeliveries(workspaceId, id, query);
  }

  @Get(':id/deliveries/:deliveryId')
  @Roles(WorkspaceRole.VIEWER)
  @ApiPermission('WEBHOOKS_READ')
  @ApiOperation({ summary: 'Get a single delivery attempt, including its event envelope' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getDelivery(
    @Param('workspaceId') workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ) {
    return this.webhooksService.getDeliveryOrThrow(workspaceId, id, deliveryId);
  }

  @Post(':id/deliveries/:deliveryId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(WorkspaceRole.ADMIN)
  @ApiPermission('WEBHOOKS_WRITE')
  @ApiOperation({
    summary: 'Manually retry a failed or exhausted delivery (ADMIN or OWNER)',
    description:
      'Creates a new attempt on the same logical delivery — same event ID, same delivery ID, incremented attempt count.',
  })
  async retryDelivery(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ) {
    return this.webhooksService.retryDelivery(
      workspaceId,
      id,
      deliveryId,
      user.id,
      ctx,
    );
  }
}
