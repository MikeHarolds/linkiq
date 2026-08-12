import type {
  CreateDomainPayload,
  DomainDto,
  DomainStatus,
  PaginatedDomainsDto,
  UpdateDomainPayload,
} from '@linkiq/types';

import { api } from './api-client';

/**
 * Domains are nested under /workspaces/:workspaceId/domains (unlike the
 * flat /links, /campaigns resources) — matches the API's own routing, see
 * apps/api/src/modules/domains/domains.controller.ts.
 */
function basePath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/domains`;
}

export function createDomain(
  workspaceId: string,
  payload: CreateDomainPayload,
): Promise<DomainDto> {
  return api.post<DomainDto>(basePath(workspaceId), payload);
}

export interface ListDomainsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: DomainStatus;
}

export function listDomains(
  workspaceId: string,
  params: ListDomainsParams = {},
): Promise<PaginatedDomainsDto> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);
  const qs = query.toString();
  return api.get<PaginatedDomainsDto>(
    `${basePath(workspaceId)}${qs ? `?${qs}` : ''}`,
  );
}

export function getDomain(
  workspaceId: string,
  domainId: string,
): Promise<DomainDto> {
  return api.get<DomainDto>(`${basePath(workspaceId)}/${domainId}`);
}

export function updateDomain(
  workspaceId: string,
  domainId: string,
  payload: UpdateDomainPayload,
): Promise<DomainDto> {
  return api.patch<DomainDto>(`${basePath(workspaceId)}/${domainId}`, payload);
}

export function deleteDomain(
  workspaceId: string,
  domainId: string,
): Promise<void> {
  return api.delete<void>(`${basePath(workspaceId)}/${domainId}`);
}

function domainAction(action: 'verify' | 'activate' | 'disable' | 'primary') {
  return (workspaceId: string, domainId: string): Promise<DomainDto> =>
    api.post<DomainDto>(`${basePath(workspaceId)}/${domainId}/${action}`);
}

export const verifyDomain = domainAction('verify');
export const activateDomain = domainAction('activate');
export const disableDomain = domainAction('disable');
export const setPrimaryDomain = domainAction('primary');
