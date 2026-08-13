import type {
  CreatedWebhookEndpointDto,
  CreateWebhookEndpointPayload,
  UpdateWebhookEndpointPayload,
  WebhookDeliveryDetailDto,
  WebhookDeliveryDto,
  WebhookDeliveryStatus,
  WebhookEndpointDto,
} from '@linkiq/types';

import { api } from './api-client';

/** Nested under /workspaces/:workspaceId/webhooks — matches the API's own
 * routing, see apps/api/src/modules/webhooks/webhooks.controller.ts. */
function basePath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/webhooks`;
}

export function createWebhookEndpoint(
  workspaceId: string,
  payload: CreateWebhookEndpointPayload,
): Promise<CreatedWebhookEndpointDto> {
  return api.post<CreatedWebhookEndpointDto>(basePath(workspaceId), payload);
}

export function listWebhookEndpoints(
  workspaceId: string,
): Promise<WebhookEndpointDto[]> {
  return api.get<WebhookEndpointDto[]>(basePath(workspaceId));
}

export function getWebhookEndpoint(
  workspaceId: string,
  endpointId: string,
): Promise<WebhookEndpointDto> {
  return api.get<WebhookEndpointDto>(`${basePath(workspaceId)}/${endpointId}`);
}

export function updateWebhookEndpoint(
  workspaceId: string,
  endpointId: string,
  payload: UpdateWebhookEndpointPayload,
): Promise<WebhookEndpointDto> {
  return api.patch<WebhookEndpointDto>(
    `${basePath(workspaceId)}/${endpointId}`,
    payload,
  );
}

export function deleteWebhookEndpoint(
  workspaceId: string,
  endpointId: string,
): Promise<void> {
  return api.delete<void>(`${basePath(workspaceId)}/${endpointId}`);
}

export function pauseWebhookEndpoint(
  workspaceId: string,
  endpointId: string,
): Promise<WebhookEndpointDto> {
  return api.post<WebhookEndpointDto>(
    `${basePath(workspaceId)}/${endpointId}/pause`,
  );
}

export function activateWebhookEndpoint(
  workspaceId: string,
  endpointId: string,
): Promise<WebhookEndpointDto> {
  return api.post<WebhookEndpointDto>(
    `${basePath(workspaceId)}/${endpointId}/activate`,
  );
}

export function rotateWebhookSecret(
  workspaceId: string,
  endpointId: string,
): Promise<CreatedWebhookEndpointDto> {
  return api.post<CreatedWebhookEndpointDto>(
    `${basePath(workspaceId)}/${endpointId}/rotate-secret`,
  );
}

export function sendTestWebhookEvent(
  workspaceId: string,
  endpointId: string,
): Promise<{ eventId: string; deliveryId: string }> {
  return api.post<{ eventId: string; deliveryId: string }>(
    `${basePath(workspaceId)}/${endpointId}/test`,
  );
}

export interface PaginatedWebhookDeliveriesDto {
  items: WebhookDeliveryDto[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface ListWebhookDeliveriesParams {
  page?: number;
  pageSize?: number;
  status?: WebhookDeliveryStatus;
}

export function listWebhookDeliveries(
  workspaceId: string,
  endpointId: string,
  params: ListWebhookDeliveriesParams = {},
): Promise<PaginatedWebhookDeliveriesDto> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.status) query.set('status', params.status);
  const qs = query.toString();
  return api.get<PaginatedWebhookDeliveriesDto>(
    `${basePath(workspaceId)}/${endpointId}/deliveries${qs ? `?${qs}` : ''}`,
  );
}

export function getWebhookDelivery(
  workspaceId: string,
  endpointId: string,
  deliveryId: string,
): Promise<WebhookDeliveryDetailDto> {
  return api.get<WebhookDeliveryDetailDto>(
    `${basePath(workspaceId)}/${endpointId}/deliveries/${deliveryId}`,
  );
}

export function retryWebhookDelivery(
  workspaceId: string,
  endpointId: string,
  deliveryId: string,
): Promise<WebhookDeliveryDto> {
  return api.post<WebhookDeliveryDto>(
    `${basePath(workspaceId)}/${endpointId}/deliveries/${deliveryId}/retry`,
  );
}
