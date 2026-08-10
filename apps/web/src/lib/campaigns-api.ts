import type {
  AnalyticsQueryParams,
  CampaignAnalyticsDto,
  CampaignDto,
  CampaignLinkDto,
  CampaignStatus,
  PaginatedCampaignsDto,
  UtmDefaults,
} from '@linkiq/types';

import { api } from './api-client';

function workspaceHeaders(workspaceId: string): HeadersInit {
  return { 'X-Workspace-Id': workspaceId };
}

export interface CreateCampaignPayload extends UtmDefaults {
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
}

export function createCampaign(
  workspaceId: string,
  payload: CreateCampaignPayload,
): Promise<CampaignDto> {
  return api.post<CampaignDto>('/campaigns', payload, {
    headers: workspaceHeaders(workspaceId),
  });
}

export interface ListCampaignsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: CampaignStatus;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function listCampaigns(
  workspaceId: string,
  params: ListCampaignsParams = {},
): Promise<PaginatedCampaignsDto> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.sortOrder) query.set('sortOrder', params.sortOrder);
  const qs = query.toString();
  return api.get<PaginatedCampaignsDto>(`/campaigns${qs ? `?${qs}` : ''}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function getCampaign(
  workspaceId: string,
  campaignId: string,
): Promise<CampaignDto> {
  return api.get<CampaignDto>(`/campaigns/${campaignId}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function getCampaignLinks(
  workspaceId: string,
  campaignId: string,
): Promise<CampaignLinkDto[]> {
  return api.get<CampaignLinkDto[]>(`/campaigns/${campaignId}/links`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function getCampaignAnalytics(
  workspaceId: string,
  campaignId: string,
  params: AnalyticsQueryParams & { interval?: 'hour' | 'day' },
): Promise<CampaignAnalyticsDto> {
  const query = new URLSearchParams();
  if (params.range) query.set('range', params.range);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.timezone) query.set('timezone', params.timezone);
  if (params.includeBots) query.set('includeBots', 'true');
  if (params.interval) query.set('interval', params.interval);
  const qs = query.toString();
  return api.get<CampaignAnalyticsDto>(
    `/campaigns/${campaignId}/analytics${qs ? `?${qs}` : ''}`,
    {
      headers: workspaceHeaders(workspaceId),
    },
  );
}

export function updateCampaign(
  workspaceId: string,
  campaignId: string,
  payload: Partial<CreateCampaignPayload>,
): Promise<CampaignDto> {
  return api.patch<CampaignDto>(`/campaigns/${campaignId}`, payload, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function deleteCampaign(
  workspaceId: string,
  campaignId: string,
): Promise<void> {
  return api.delete<void>(`/campaigns/${campaignId}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

function transitionCampaign(action: 'activate' | 'pause' | 'archive') {
  return (workspaceId: string, campaignId: string): Promise<CampaignDto> =>
    api.post<CampaignDto>(`/campaigns/${campaignId}/${action}`, undefined, {
      headers: workspaceHeaders(workspaceId),
    });
}

export const activateCampaign = transitionCampaign('activate');
export const pauseCampaign = transitionCampaign('pause');
export const archiveCampaign = transitionCampaign('archive');
