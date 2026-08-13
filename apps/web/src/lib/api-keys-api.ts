import type {
  ApiKeyDto,
  CreateApiKeyPayload,
  CreatedApiKeyDto,
} from '@linkiq/types';

import { api } from './api-client';

/** Nested under /workspaces/:workspaceId/api-keys — matches the API's own
 * routing, see apps/api/src/modules/api-keys/api-keys.controller.ts. */
function basePath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/api-keys`;
}

export function createApiKey(
  workspaceId: string,
  payload: CreateApiKeyPayload,
): Promise<CreatedApiKeyDto> {
  return api.post<CreatedApiKeyDto>(basePath(workspaceId), payload);
}

export function listApiKeys(workspaceId: string): Promise<ApiKeyDto[]> {
  return api.get<ApiKeyDto[]>(basePath(workspaceId));
}

export function getApiKey(
  workspaceId: string,
  apiKeyId: string,
): Promise<ApiKeyDto> {
  return api.get<ApiKeyDto>(`${basePath(workspaceId)}/${apiKeyId}`);
}

export function revokeApiKey(
  workspaceId: string,
  apiKeyId: string,
): Promise<ApiKeyDto> {
  return api.post<ApiKeyDto>(`${basePath(workspaceId)}/${apiKeyId}/revoke`);
}

export function deleteApiKey(
  workspaceId: string,
  apiKeyId: string,
): Promise<void> {
  return api.delete<void>(`${basePath(workspaceId)}/${apiKeyId}`);
}
