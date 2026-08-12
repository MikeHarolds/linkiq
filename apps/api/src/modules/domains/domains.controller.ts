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

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  Ctx,
  type RequestContext,
} from '../../common/decorators/request-context.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

import { DomainsService } from './domains.service';
import { CreateDomainDto } from './dto/create-domain.dto';
import { QueryDomainsDto } from './dto/query-domains.dto';
import { UpdateDomainDto } from './dto/update-domain.dto';
import { verificationRecordName } from './verification/domain-verification.provider';

/**
 * Nested under /workspaces/:workspaceId/domains (unlike the flat
 * /links, /qrcodes, /campaigns resources) — matches the pattern
 * workspaces.controller.ts already establishes for workspace
 * sub-resources, and WorkspaceRolesGuard already resolves workspaceId
 * from the :workspaceId route param with no changes needed.
 *
 * Role cutoffs mirror the exact precedent in links.controller.ts /
 * campaigns.controller.ts: VIEWER for reads, MEMBER for every mutation
 * including lifecycle transitions — there is no ADMIN-gated precedent for
 * resource-level actions anywhere else in the codebase.
 */
@ApiTags('domains')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/domains')
@UseGuards(WorkspaceRolesGuard)
export class DomainsController {
  constructor(private readonly domainsService: DomainsService) {}

  @Post()
  @Roles('MEMBER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a custom domain (MEMBER, ADMIN, or OWNER)',
  })
  @ApiResponse({
    status: 201,
    description: 'Domain created, PENDING verification',
  })
  @ApiResponse({ status: 409, description: 'Domain already registered' })
  async create(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Body() dto: CreateDomainDto,
  ) {
    const domain = await this.domainsService.create(
      workspaceId,
      user.id,
      dto,
      ctx,
    );
    return toResponse(domain);
  }

  @Get()
  @Roles('VIEWER')
  @ApiOperation({ summary: 'List custom domains in the workspace' })
  @ApiResponse({ status: 200, description: 'Paginated domain list' })
  async findAll(
    @Param('workspaceId') workspaceId: string,
    @Query() query: QueryDomainsDto,
  ) {
    const result = await this.domainsService.findAll(workspaceId, query);
    return { ...result, items: result.items.map(toResponse) };
  }

  @Get(':id')
  @Roles('VIEWER')
  @ApiOperation({ summary: 'Get a single custom domain' })
  @ApiResponse({ status: 200, description: 'Domain details' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('workspaceId') workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const domain = await this.domainsService.findByIdOrThrow(workspaceId, id);
    return toResponse(domain);
  }

  @Patch(':id')
  @Roles('MEMBER')
  @ApiOperation({ summary: 'Update a custom domain (MEMBER, ADMIN, or OWNER)' })
  @ApiResponse({ status: 200, description: 'Domain updated' })
  async update(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDomainDto,
  ) {
    const domain = await this.domainsService.update(
      workspaceId,
      id,
      user.id,
      dto,
      ctx,
    );
    return toResponse(domain);
  }

  @Delete(':id')
  @Roles('MEMBER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Soft-delete a custom domain (MEMBER, ADMIN, or OWNER)',
  })
  @ApiResponse({ status: 204, description: 'Domain deleted' })
  async remove(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.domainsService.softDelete(workspaceId, id, user.id, ctx);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @Roles('MEMBER')
  @ApiOperation({
    summary:
      'Attempt DNS TXT verification for a domain (MEMBER, ADMIN, or OWNER)',
    description:
      'Checks for the expected _linkiq-verification.<domain> TXT record. Never reports success merely because this endpoint was called.',
  })
  @ApiResponse({
    status: 200,
    description: 'Verification attempted; status reflects the outcome',
  })
  async verify(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const domain = await this.domainsService.verify(
      workspaceId,
      id,
      user.id,
      ctx,
    );
    return toResponse(domain);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Roles('MEMBER')
  @ApiOperation({
    summary: 'Activate a verified domain (MEMBER, ADMIN, or OWNER)',
  })
  @ApiResponse({ status: 200, description: 'Domain activated' })
  @ApiResponse({ status: 400, description: 'Domain is not verified' })
  async activate(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const domain = await this.domainsService.activate(
      workspaceId,
      id,
      user.id,
      ctx,
    );
    return toResponse(domain);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @Roles('MEMBER')
  @ApiOperation({
    summary: 'Disable an active domain (MEMBER, ADMIN, or OWNER)',
  })
  @ApiResponse({ status: 200, description: 'Domain disabled' })
  @ApiResponse({ status: 400, description: 'Domain is not active' })
  async disable(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const domain = await this.domainsService.disable(
      workspaceId,
      id,
      user.id,
      ctx,
    );
    return toResponse(domain);
  }

  @Post(':id/primary')
  @HttpCode(HttpStatus.OK)
  @Roles('MEMBER')
  @ApiOperation({
    summary:
      'Set this domain as the workspace primary (MEMBER, ADMIN, or OWNER)',
    description: 'Unsets any previously primary domain in the same request.',
  })
  @ApiResponse({ status: 200, description: 'Primary domain updated' })
  async setPrimary(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const domain = await this.domainsService.setPrimary(
      workspaceId,
      id,
      user.id,
      ctx,
    );
    return toResponse(domain);
  }
}

/** Adds the derived verification-instructions fields to every domain
 * response — computed, never stored, so instructions always match the
 * domain's current token. */
function toResponse(domain: {
  id: string;
  workspaceId: string;
  domain: string;
  normalizedDomain: string;
  status: string;
  verificationToken: string;
  verificationCheckedAt: Date | null;
  verifiedAt: Date | null;
  isPrimary: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...domain,
    verification: {
      recordName: verificationRecordName(domain.normalizedDomain),
      recordType: 'TXT',
      recordValue: domain.verificationToken,
    },
  };
}
