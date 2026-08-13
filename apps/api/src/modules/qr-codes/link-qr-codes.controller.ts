import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { WorkspaceMember } from '@prisma/client';

import { ApiPermission } from '../../common/decorators/api-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../../common/decorators/current-workspace.decorator';
import {
  Ctx,
  type RequestContext,
} from '../../common/decorators/request-context.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

import { CreateQrCodeDto } from './dto/create-qr-code.dto';
import { QrCodesService } from './qr-codes.service';

/**
 * QR codes are always created in the context of an existing link — see
 * QrCodesService's docs on why a QR code can never exist without one.
 * This controller is intentionally thin: creation and per-link listing
 * only. Everything else (get/update/delete/download a specific QR code,
 * or list across the whole workspace) lives on QrCodesController at
 * /qrcodes, since those operations are naturally about the QR code
 * itself, not about "this link's QR codes."
 */
@ApiTags('qr-codes')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Workspace-Id',
  required: true,
  description: 'Active workspace context',
})
@Controller('links/:linkId/qrcodes')
export class LinkQrCodesController {
  constructor(private readonly qrCodesService: QrCodesService) {}

  @Post()
  @UseGuards(WorkspaceRolesGuard)
  @Roles('MEMBER')
  @ApiPermission('QRCODES_WRITE')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a QR code for a link (MEMBER, ADMIN, or OWNER)',
  })
  @ApiResponse({ status: 201, description: 'QR code created' })
  @ApiResponse({ status: 400, description: 'Invalid QR configuration' })
  @ApiResponse({ status: 404, description: 'Link not found' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() dto: CreateQrCodeDto,
  ) {
    return this.qrCodesService.create(
      workspace.workspaceId,
      linkId,
      user.id,
      dto,
      ctx,
    );
  }

  @Get()
  @UseGuards(WorkspaceRolesGuard)
  @Roles('VIEWER')
  @ApiPermission('QRCODES_READ')
  @ApiOperation({ summary: 'List QR codes for a link' })
  @ApiResponse({ status: 200, description: 'QR codes for the link' })
  @ApiResponse({ status: 404, description: 'Link not found' })
  async findAllForLink(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Param('linkId', ParseUUIDPipe) linkId: string,
  ) {
    return this.qrCodesService.findAllForLink(workspace.workspaceId, linkId);
  }
}
