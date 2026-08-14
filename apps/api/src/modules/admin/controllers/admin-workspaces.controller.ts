import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import { QueryWorkspacesDto } from '../dto/query-workspaces.dto';
import { AdminWorkspacesService } from '../services/admin-workspaces.service';

@ApiTags('admin-workspaces')
@ApiBearerAuth()
@Controller('admin/workspaces')
@UseGuards(SuperAdminGuard)
export class AdminWorkspacesController {
  constructor(private readonly adminWorkspaces: AdminWorkspacesService) {}

  @Get()
  @ApiOperation({ summary: 'List platform workspaces (SUPER_ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Paginated workspace list' })
  async list(@Query() query: QueryWorkspacesDto) {
    return this.adminWorkspaces.list(query);
  }

  @Get(':workspaceId')
  @ApiOperation({
    summary:
      'View a workspace: owner, members, subscription, usage, domains, API keys, webhooks, audit',
  })
  async getDetail(@Param('workspaceId') workspaceId: string) {
    return this.adminWorkspaces.getDetail(workspaceId);
  }
}
