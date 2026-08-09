import type { WorkspaceRole } from '@prisma/client';

/**
 * Workspace role hierarchy, highest privilege first. A member with a given
 * role implicitly has all permissions of roles ranked below it — e.g. an
 * ADMIN passes a `@Roles('MEMBER')` check.
 *
 * Implemented as a switch rather than a Record lookup so it stays exhaustive
 * (a new WorkspaceRole added to the schema without a case here is a
 * compile error) without fighting noUncheckedIndexedAccess.
 */
function rankOf(role: WorkspaceRole): number {
  switch (role) {
    case 'OWNER':
      return 3;
    case 'ADMIN':
      return 2;
    case 'MEMBER':
      return 1;
    case 'VIEWER':
      return 0;
    default:
      throw new Error(`Unknown workspace role: ${String(role)}`);
  }
}

/** Returns true if `role` satisfies at least one of `required`. */
export function hasSufficientRole(
  role: WorkspaceRole,
  required: WorkspaceRole[],
): boolean {
  if (required.length === 0) {
    return true;
  }
  const minimumRequired = Math.min(...required.map(rankOf));
  return rankOf(role) >= minimumRequired;
}
