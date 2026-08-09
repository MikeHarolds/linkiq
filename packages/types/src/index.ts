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
  emailVerified: boolean;
  createdAt: string;
}

export interface WorkspaceSummaryDto {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

export interface AuthResponseDto {
  accessToken: string;
  user: UserDto;
  workspaces: WorkspaceSummaryDto[];
}

export interface MeResponseDto {
  user: UserDto;
  workspaces: WorkspaceSummaryDto[];
}

export interface WorkspaceMemberDto {
  id: string;
  role: WorkspaceRole;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string | null;
  };
}

export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  timestamp: string;
}

export type LinkStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export interface LinkDto {
  id: string;
  workspaceId: string;
  createdById: string | null;
  destinationUrl: string;
  shortCode: string;
  title: string | null;
  description: string | null;
  status: LinkStatus;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface PaginatedLinksDto {
  items: LinkDto[];
  pagination: PaginationMeta;
}

export interface LinkStatsDto {
  totalLinks: number;
  activeLinks: number;
  pausedLinks: number;
  expiredLinks: number;
  archivedLinks: number;
  recentLinks: LinkDto[];
}

// Campaign, QrCode, Analytics, and Billing DTOs are added
// as their respective backend modules are implemented.
