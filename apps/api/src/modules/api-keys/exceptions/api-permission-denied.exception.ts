import { ForbiddenException } from '@nestjs/common';

/** The API key is valid and belongs to the right workspace, but wasn't
 * granted the scope this route requires — see WorkspaceRolesGuard's
 * API-key branch and the @ApiPermission(...) decorator. */
export class ApiPermissionDeniedException extends ForbiddenException {
  constructor(permission: string) {
    super({
      code: 'API_PERMISSION_DENIED',
      permission,
      message: `This API key does not have the "${permission}" permission.`,
    });
  }
}
