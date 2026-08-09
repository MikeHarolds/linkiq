import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { WorkspaceMember } from '@prisma/client';

/**
 * Extracts the resolved + membership-checked workspace context attached
 * to the request by WorkspaceRolesGuard. Only usable on routes decorated
 * with @Roles(...) (which applies WorkspaceRolesGuard).
 */
export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceMember => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ workspaceMember: WorkspaceMember }>();
    return request.workspaceMember;
  },
);
