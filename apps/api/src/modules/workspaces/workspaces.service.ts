import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  WorkspaceRole,
  type Workspace,
  type WorkspaceMember,
} from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { uniqueSlug } from '../../common/utils/slugify';
import { AuditService } from '../audit/audit.service';
import { BillingUsageService } from '../billing/billing-usage.service';
import { SubscriptionsService } from '../billing/subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';

import type { CreateWorkspaceDto } from './dto/create-workspace.dto';
import type { InviteMemberDto } from './dto/invite-member.dto';
import type { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import type { UpdateWorkspaceDto } from './dto/update-workspace.dto';

export interface WorkspaceMemberWithUser extends WorkspaceMember {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
  };
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
    private readonly usage: BillingUsageService,
  ) {}

  async listForUser(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      role: m.role,
      createdAt: m.workspace.createdAt,
    }));
  }

  async create(
    userId: string,
    dto: CreateWorkspaceDto,
    ctx: RequestContext,
  ): Promise<Workspace> {
    const workspace = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: dto.name,
          slug: uniqueSlug(dto.name),
          ownerId: userId,
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: dto.name,
          slug: 'main',
          organizationId: organization.id,
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId,
          role: WorkspaceRole.OWNER,
        },
      });

      // Same transaction as the workspace itself — see AuthService.register
      // for why this must never be a separate, skippable step.
      await this.subscriptions.createDefaultSubscription(tx, workspace.id);

      return workspace;
    });

    await this.audit.record({
      action: 'workspace.created',
      entity: 'Workspace',
      entityId: workspace.id,
      userId,
      workspaceId: workspace.id,
      metadata: { name: workspace.name },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return workspace;
  }

  async findByIdOrThrow(workspaceId: string): Promise<Workspace> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    return workspace;
  }

  async update(
    workspaceId: string,
    userId: string,
    dto: UpdateWorkspaceDto,
    ctx: RequestContext,
  ): Promise<Workspace> {
    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: dto.name },
    });

    await this.audit.record({
      action: 'workspace.updated',
      entity: 'Workspace',
      entityId: workspaceId,
      userId,
      workspaceId,
      metadata: { name: dto.name },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return workspace;
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMemberWithUser[]> {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Adds an existing user to the workspace by email. LinkIQ doesn't yet
   * integrate a real email provider (per Sprint 1 scope), so this only
   * supports inviting people who already have an account — there is no
   * pending-invitation-by-token flow for not-yet-registered emails yet.
   */
  async inviteMember(
    workspaceId: string,
    inviterId: string,
    dto: InviteMemberDto,
    ctx: RequestContext,
  ): Promise<WorkspaceMemberWithUser> {
    const email = dto.email.trim().toLowerCase();
    const invitedUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!invitedUser) {
      throw new NotFoundException(
        'No LinkIQ account exists for that email yet — they need to register first',
      );
    }

    const existingMembership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId: invitedUser.id },
      },
    });

    if (existingMembership) {
      throw new ConflictException(
        'This user is already a member of the workspace',
      );
    }

    await this.usage.assertCanUse(workspaceId, 'MAX_TEAM_MEMBERS', 'team members');

    const role = dto.role ?? WorkspaceRole.MEMBER;

    const member = await this.prisma.workspaceMember.create({
      data: { workspaceId, userId: invitedUser.id, role },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
    });

    await this.audit.record({
      action: 'workspace.member_invited',
      entity: 'WorkspaceMember',
      entityId: member.id,
      userId: inviterId,
      workspaceId,
      metadata: { invitedUserId: invitedUser.id, email, role },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return member;
  }

  async updateMemberRole(
    workspaceId: string,
    memberId: string,
    actorId: string,
    dto: UpdateMemberRoleDto,
    ctx: RequestContext,
  ): Promise<WorkspaceMember> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { id: memberId },
    });

    if (!member || member.workspaceId !== workspaceId) {
      throw new NotFoundException('Workspace member not found');
    }

    if (
      member.role === WorkspaceRole.OWNER &&
      dto.role !== WorkspaceRole.OWNER
    ) {
      await this.assertNotLastOwner(workspaceId, member.id);
    }

    const updated = await this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role: dto.role },
    });

    await this.audit.record({
      action: 'workspace.member_role_changed',
      entity: 'WorkspaceMember',
      entityId: memberId,
      userId: actorId,
      workspaceId,
      metadata: {
        targetUserId: member.userId,
        previousRole: member.role,
        newRole: dto.role,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  async removeMember(
    workspaceId: string,
    memberId: string,
    actorId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { id: memberId },
    });

    if (!member || member.workspaceId !== workspaceId) {
      throw new NotFoundException('Workspace member not found');
    }

    if (member.role === WorkspaceRole.OWNER) {
      await this.assertNotLastOwner(workspaceId, member.id);
    }

    await this.prisma.workspaceMember.delete({ where: { id: memberId } });

    await this.audit.record({
      action: 'workspace.member_removed',
      entity: 'WorkspaceMember',
      entityId: memberId,
      userId: actorId,
      workspaceId,
      metadata: { targetUserId: member.userId, role: member.role },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /** Guards against ever leaving a workspace without an OWNER. */
  private async assertNotLastOwner(
    workspaceId: string,
    excludingMemberId: string,
  ): Promise<void> {
    const otherOwners = await this.prisma.workspaceMember.count({
      where: {
        workspaceId,
        role: WorkspaceRole.OWNER,
        id: { not: excludingMemberId },
      },
    });

    if (otherOwners === 0) {
      throw new BadRequestException(
        'A workspace must always have at least one owner — transfer ownership before removing or demoting the last owner',
      );
    }
  }
}
