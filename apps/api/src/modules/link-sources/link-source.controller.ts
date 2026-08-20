import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Body,
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

import { UpdateLinkSourceDto } from './dto/update-link-source.dto';
import { LinkSourcesService } from './link-sources.service';

@ApiTags('link-sources')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Workspace-Id',
  required: true,
  description: 'Active workspace context',
})
@Controller('link-sources')
export class LinkSourceController {
  constructor(private readonly linkSourcesService: LinkSourcesService) {}

  @Get(':id')
  @UseGuards(WorkspaceRolesGuard)
  @Roles('VIEWER')
  @ApiPermission('LINK_SOURCES_READ')
  @ApiOperation({ summary: 'Get a single tracking source' })
  @ApiResponse({ status: 200, description: 'Tracking source details' })
  @ApiResponse({
    status: 404,
    description: 'Not found (including sources in another workspace)',
  })
  async findOne(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.linkSourcesService.findByIdOrThrow(workspace.workspaceId, id);
  }

  @Patch(':id')
  @UseGuards(WorkspaceRolesGuard)
  @Roles('MEMBER')
  @ApiPermission('LINK_SOURCES_WRITE')
  @ApiOperation({
    summary:
      'Update a tracking source, including Activate/Deactivate (MEMBER, ADMIN, or OWNER)',
  })
  @ApiResponse({ status: 200, description: 'Tracking source updated' })
  @ApiResponse({
    status: 409,
    description: 'This link already has an active source with this key',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLinkSourceDto,
  ) {
    return this.linkSourcesService.update(
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
  @ApiPermission('LINK_SOURCES_WRITE')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Delete a tracking source (soft delete — MEMBER, ADMIN, or OWNER)',
  })
  @ApiResponse({ status: 204, description: 'Tracking source deleted' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.linkSourcesService.softDelete(
      workspace.workspaceId,
      id,
      user.id,
      ctx,
    );
  }
}
