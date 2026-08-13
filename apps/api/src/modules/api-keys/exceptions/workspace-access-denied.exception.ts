import { ForbiddenException } from '@nestjs/common';

/** Thrown when a route's explicit :workspaceId param doesn't match the
 * workspace the authenticated API key belongs to. The key's own
 * workspaceId is never overridden by anything the caller supplies — see
 * docs/architecture/api-keys.md §Workspace isolation. */
export class WorkspaceAccessDeniedException extends ForbiddenException {
  constructor() {
    super({
      code: 'WORKSPACE_ACCESS_DENIED',
      message: 'This API key does not have access to the requested workspace.',
    });
  }
}
