/**
 * Shared TypeScript types/contracts between apps/web and apps/api.
 * Keep this package framework-agnostic (no Next.js or Nest imports).
 */

export type GlobalRole = 'SUPER_ADMIN' | 'USER';

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export interface UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  globalRole: GlobalRole;
}

export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  timestamp: string;
}

// Link, Campaign, QrCode, Analytics, and Billing DTOs are added
// as their respective backend modules are implemented.
