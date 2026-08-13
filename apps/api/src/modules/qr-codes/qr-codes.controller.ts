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
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { QrFormat, WorkspaceMember } from '@prisma/client';
import type { Response } from 'express';

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

import { QueryQrCodesDto } from './dto/query-qr-codes.dto';
import { UpdateQrCodeDto } from './dto/update-qr-code.dto';
import { QrCodesService } from './qr-codes.service';

@ApiTags('qr-codes')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Workspace-Id',
  required: true,
  description: 'Active workspace context',
})
@Controller('qrcodes')
export class QrCodesController {
  constructor(private readonly qrCodesService: QrCodesService) {}

  @Get()
  @UseGuards(WorkspaceRolesGuard)
  @Roles('VIEWER')
  @ApiPermission('QRCODES_READ')
  @ApiOperation({
    summary: 'List QR codes across the workspace (paginated, searchable)',
  })
  @ApiResponse({ status: 200, description: 'Paginated QR code list' })
  async findAll(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Query() query: QueryQrCodesDto,
  ) {
    return this.qrCodesService.findAllForWorkspace(
      workspace.workspaceId,
      query,
    );
  }

  @Get(':id')
  @UseGuards(WorkspaceRolesGuard)
  @Roles('VIEWER')
  @ApiPermission('QRCODES_READ')
  @ApiOperation({ summary: 'Get a single QR code' })
  @ApiResponse({ status: 200, description: 'QR code details' })
  @ApiResponse({
    status: 404,
    description: 'Not found (including QR codes in another workspace)',
  })
  async findOne(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.qrCodesService.findByIdOrThrow(workspace.workspaceId, id);
  }

  @Patch(':id')
  @UseGuards(WorkspaceRolesGuard)
  @Roles('MEMBER')
  @ApiPermission('QRCODES_WRITE')
  @ApiOperation({
    summary: 'Update a QR code appearance (MEMBER, ADMIN, or OWNER)',
  })
  @ApiResponse({ status: 200, description: 'QR code updated' })
  @ApiResponse({ status: 400, description: 'Invalid QR configuration' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQrCodeDto,
  ) {
    return this.qrCodesService.update(
      workspace.workspaceId,
      id,
      user.id,
      dto,
      ctx,
    );
  }

  @Delete(':id')
  @UseGuards(WorkspaceRolesGuard)
  @Roles('MEMBER')
  @ApiPermission('QRCODES_WRITE')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a QR code (MEMBER, ADMIN, or OWNER)' })
  @ApiResponse({ status: 204, description: 'QR code deleted' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.qrCodesService.softDelete(
      workspace.workspaceId,
      id,
      user.id,
      ctx,
    );
  }

  @Get(':id/download')
  @UseGuards(WorkspaceRolesGuard)
  @Roles('VIEWER')
  @ApiPermission('QRCODES_READ')
  @ApiQuery({ name: 'format', enum: ['PNG', 'SVG'], required: false })
  @ApiOperation({
    summary: 'Download the generated QR image (VIEWER and above)',
  })
  @ApiResponse({
    status: 200,
    description: 'Image bytes (image/png or image/svg+xml)',
  })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') format: QrFormat | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.qrCodesService.generateDownload(
      workspace.workspaceId,
      id,
      user.id,
      format,
      ctx,
    );

    res.set({
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      // Never cache a QR download at an intermediary — the underlying
      // link (and therefore what the code should point to) can change.
      'Cache-Control': 'no-store',
    });
    res.send(result.data);
  }
}
