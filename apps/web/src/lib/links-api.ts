import type { LinkDto, LinkStatsDto, PaginatedLinksDto } from '@linkiq/types';

import { api } from './api-client';

export interface ListLinksParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Thin wrapper around the generic API client that bakes in the
 * `X-Workspace-Id` header every /links endpoint requires (see
 * WorkspaceRolesGuard on the backend) — keeps components from repeating
 * that header on every call.
 */
function workspaceHeaders(workspaceId: string): HeadersInit {
  return { 'X-Workspace-Id': workspaceId };
}

export function listLinks(
  workspaceId: string,
  params: ListLinksParams = {},
): Promise<PaginatedLinksDto> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.sortOrder) query.set('sortOrder', params.sortOrder);

  const qs = query.toString();
  return api.get<PaginatedLinksDto>(`/links${qs ? `?${qs}` : ''}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function getLinkStats(workspaceId: string): Promise<LinkStatsDto> {
  return api.get<LinkStatsDto>('/links/stats', {
    headers: workspaceHeaders(workspaceId),
  });
}

export function getLink(workspaceId: string, linkId: string): Promise<LinkDto> {
  return api.get<LinkDto>(`/links/${linkId}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export interface CreateLinkPayload {
  destinationUrl: string;
  slug?: string;
  title?: string;
  description?: string;
  expiresAt?: string;
  campaignId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

export function createLink(
  workspaceId: string,
  payload: CreateLinkPayload,
): Promise<LinkDto> {
  return api.post<LinkDto>('/links', payload, {
    headers: workspaceHeaders(workspaceId),
  });
}

export interface UpdateLinkPayload {
  destinationUrl?: string;
  title?: string;
  description?: string;
  expiresAt?: string | null;
}

export function updateLink(
  workspaceId: string,
  linkId: string,
  payload: UpdateLinkPayload,
): Promise<LinkDto> {
  return api.patch<LinkDto>(`/links/${linkId}`, payload, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function deleteLink(workspaceId: string, linkId: string): Promise<void> {
  return api.delete<void>(`/links/${linkId}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function pauseLink(
  workspaceId: string,
  linkId: string,
): Promise<LinkDto> {
  return api.post<LinkDto>(`/links/${linkId}/pause`, undefined, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function activateLink(
  workspaceId: string,
  linkId: string,
): Promise<LinkDto> {
  return api.post<LinkDto>(`/links/${linkId}/activate`, undefined, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function archiveLink(
  workspaceId: string,
  linkId: string,
): Promise<LinkDto> {
  return api.post<LinkDto>(`/links/${linkId}/archive`, undefined, {
    headers: workspaceHeaders(workspaceId),
  });
}
