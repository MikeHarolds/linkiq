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

import { CreateLinkSourceDto } from './dto/create-link-source.dto';
import { LinkSourcesService } from './link-sources.service';

/**
 * Tracking sources always belong to an existing link — this controller
 * is intentionally thin: creation and per-link listing only, mirroring
 * LinkQrCodesController. Get-one/update/deactivate/delete live on
 * LinkSourceController at /link-sources, since those operations are
 * naturally about the tracking source itself.
 */
@ApiTags('link-sources')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Workspace-Id',
  required: true,
  description: 'Active workspace context',
})
@Controller('links/:linkId/sources')
export class LinkSourcesController {
  constructor(private readonly linkSourcesService: LinkSourcesService) {}

  @Post()
  @UseGuards(WorkspaceRolesGuard)
  @Roles('MEMBER')
  @ApiPermission('LINK_SOURCES_WRITE')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a tracking source for a link (MEMBER, ADMIN, or OWNER)',
  })
  @ApiResponse({ status: 201, description: 'Tracking source created' })
  @ApiResponse({ status: 404, description: 'Link not found' })
  @ApiResponse({
    status: 409,
    description: 'This link already has an active source with this key',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() dto: CreateLinkSourceDto,
  ) {
    return this.linkSourcesService.create(
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
  @ApiPermission('LINK_SOURCES_READ')
  @ApiOperation({ summary: 'List tracking sources for a link' })
  @ApiResponse({ status: 200, description: 'Tracking sources for the link' })
  @ApiResponse({ status: 404, description: 'Link not found' })
  async findAllForLink(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Param('linkId', ParseUUIDPipe) linkId: string,
  ) {
    return this.linkSourcesService.findAllForLink(workspace.workspaceId, linkId);
  }
}
