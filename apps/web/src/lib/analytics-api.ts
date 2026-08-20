import type {
  AnalyticsOverviewDto,
  AnalyticsQueryParams,
  AnalyticsTimeseriesPointDto,
  BreakdownItemDto,
  GeographyDto,
  ReferrerDto,
  SourceBreakdownDto,
  TopLinkDto,
} from '@linkiq/types';

import { api } from './api-client';

function workspaceHeaders(workspaceId: string): HeadersInit {
  return { 'X-Workspace-Id': workspaceId };
}

function buildQuery(
  params: AnalyticsQueryParams & { interval?: 'hour' | 'day' },
): string {
  const query = new URLSearchParams();
  if (params.linkId) query.set('linkId', params.linkId);
  if (params.range) query.set('range', params.range);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.timezone) query.set('timezone', params.timezone);
  if (params.includeBots) query.set('includeBots', 'true');
  if (params.interval) query.set('interval', params.interval);
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

export function getOverview(
  workspaceId: string,
  params: AnalyticsQueryParams,
): Promise<AnalyticsOverviewDto> {
  return api.get(`/analytics/overview${buildQuery(params)}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function getTimeseries(
  workspaceId: string,
  params: AnalyticsQueryParams & { interval?: 'hour' | 'day' },
): Promise<AnalyticsTimeseriesPointDto[]> {
  return api.get(`/analytics/timeseries${buildQuery(params)}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function getTopLinks(
  workspaceId: string,
  params: AnalyticsQueryParams,
): Promise<TopLinkDto[]> {
  return api.get(`/analytics/links${buildQuery(params)}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function getReferrers(
  workspaceId: string,
  params: AnalyticsQueryParams,
): Promise<ReferrerDto[]> {
  return api.get(`/analytics/referrers${buildQuery(params)}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function getSourceBreakdown(
  workspaceId: string,
  params: AnalyticsQueryParams,
): Promise<SourceBreakdownDto[]> {
  return api.get(`/analytics/sources${buildQuery(params)}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function getGeography(
  workspaceId: string,
  params: AnalyticsQueryParams,
): Promise<GeographyDto> {
  return api.get(`/analytics/geography${buildQuery(params)}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function getDevices(
  workspaceId: string,
  params: AnalyticsQueryParams,
): Promise<BreakdownItemDto[]> {
  return api.get(`/analytics/devices${buildQuery(params)}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function getBrowsers(
  workspaceId: string,
  params: AnalyticsQueryParams,
): Promise<BreakdownItemDto[]> {
  return api.get(`/analytics/browsers${buildQuery(params)}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function getOperatingSystems(
  workspaceId: string,
  params: AnalyticsQueryParams,
): Promise<BreakdownItemDto[]> {
  return api.get(`/analytics/operating-systems${buildQuery(params)}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export interface CampaignBreakdownItemDto {
  campaignId: string | null;
  name: string;
  clicks: number;
}

export function getTopCampaigns(
  workspaceId: string,
  params: AnalyticsQueryParams,
): Promise<CampaignBreakdownItemDto[]> {
  return api.get(`/analytics/campaigns${buildQuery(params)}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function getUtmBreakdown(
  workspaceId: string,
  field: 'source' | 'medium' | 'campaign' | 'term' | 'content',
  params: AnalyticsQueryParams,
): Promise<BreakdownItemDto[]> {
  return api.get(`/analytics/utm/${field}${buildQuery(params)}`, {
    headers: workspaceHeaders(workspaceId),
  });
}
