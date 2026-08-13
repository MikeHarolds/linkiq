import {
  Body,
  Controller,
  Delete,
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
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { WorkspaceRole } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  Ctx,
  type RequestContext,
} from '../../common/decorators/request-context.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

import { ApiKeysService, type SafeApiKey } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

function deriveStatus(apiKey: SafeApiKey): 'ACTIVE' | 'EXPIRED' | 'REVOKED' {
  if (apiKey.revokedAt) return 'REVOKED';
  if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) {
    return 'EXPIRED';
  }
  return 'ACTIVE';
}

function toResponse(apiKey: SafeApiKey) {
  return { ...apiKey, status: deriveStatus(apiKey) };
}

/**
 * Workspace-settings surface for managing API keys — a browser/JWT-only
 * concern (no @ApiPermission here), the same way Sprint 7's billing
 * management endpoints are ADMIN+ only and not themselves API-key
 * reachable. The keys created here are what everything under
 * @ApiPermission(...) elsewhere in the API actually authenticates with.
 */
@ApiTags('api-keys')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/api-keys')
@UseGuards(WorkspaceRolesGuard)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @Roles(WorkspaceRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an API key (ADMIN or OWNER)',
    description:
      'The full secret is returned exactly once, in this response. It cannot be retrieved again — only its prefix is ever shown afterward.',
  })
  @ApiResponse({ status: 201, description: 'API key created' })
  async create(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Body() dto: CreateApiKeyDto,
  ) {
    const created = await this.apiKeysService.create(
      workspaceId,
      user.id,
      dto,
      ctx,
    );
    return { ...toResponse(created), key: created.key };
  }

  @Get()
  @Roles(WorkspaceRole.VIEWER)
  @ApiOperation({ summary: 'List API keys in the workspace' })
  @ApiResponse({
    status: 200,
    description: 'API key list (never includes secrets)',
  })
  async findAll(@Param('workspaceId') workspaceId: string) {
    const keys = await this.apiKeysService.findAll(workspaceId);
    return keys.map(toResponse);
  }

  @Get(':id')
  @Roles(WorkspaceRole.VIEWER)
  @ApiOperation({ summary: 'Get a single API key' })
  @ApiResponse({ status: 200, description: 'API key details' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('workspaceId') workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const apiKey = await this.apiKeysService.findByIdOrThrow(workspaceId, id);
    return toResponse(apiKey);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @Roles(WorkspaceRole.ADMIN)
  @ApiOperation({
    summary: 'Revoke an API key (ADMIN or OWNER)',
    description:
      'Takes effect immediately — the key stops authenticating on its very next use.',
  })
  @ApiResponse({ status: 200, description: 'API key revoked' })
  async revoke(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const apiKey = await this.apiKeysService.revoke(
      workspaceId,
      id,
      user.id,
      ctx,
    );
    return toResponse(apiKey);
  }

  @Delete(':id')
  @Roles(WorkspaceRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Permanently delete an API key (ADMIN or OWNER)' })
  @ApiResponse({ status: 204, description: 'API key deleted' })
  async remove(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.apiKeysService.remove(workspaceId, id, user.id, ctx);
  }
}
