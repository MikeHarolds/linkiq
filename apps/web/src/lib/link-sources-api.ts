import { api } from './api-client';

function workspaceHeaders(workspaceId: string): HeadersInit {
  return { 'X-Workspace-Id': workspaceId };
}

export interface LinkSourceDto {
  id: string;
  workspaceId: string;
  linkId: string;
  name: string;
  source: string;
  medium: string;
  campaign: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LinkSourceWithStatsDto extends LinkSourceDto {
  trackingUrl: string;
  clickCount: number;
}

export interface LinkSourceInput {
  name: string;
  source: string;
  medium: string;
  campaign?: string;
}

export function createLinkSource(
  workspaceId: string,
  linkId: string,
  payload: LinkSourceInput,
): Promise<LinkSourceWithStatsDto> {
  return api.post<LinkSourceWithStatsDto>(`/links/${linkId}/sources`, payload, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function listLinkSources(
  workspaceId: string,
  linkId: string,
): Promise<LinkSourceWithStatsDto[]> {
  return api.get<LinkSourceWithStatsDto[]>(`/links/${linkId}/sources`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function updateLinkSource(
  workspaceId: string,
  id: string,
  payload: Partial<LinkSourceInput> & { isActive?: boolean },
): Promise<LinkSourceDto> {
  return api.patch<LinkSourceDto>(`/link-sources/${id}`, payload, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function deleteLinkSource(
  workspaceId: string,
  id: string,
): Promise<void> {
  return api.delete<void>(`/link-sources/${id}`, {
    headers: workspaceHeaders(workspaceId),
  });
}
