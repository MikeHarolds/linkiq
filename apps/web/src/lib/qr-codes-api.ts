import type {
  PaginatedQrCodesDto,
  QrCodeDto,
  QrErrorCorrectionLevel,
  QrFormat,
} from '@linkiq/types';

import { api, getAccessToken } from './api-client';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

function workspaceHeaders(workspaceId: string): HeadersInit {
  return { 'X-Workspace-Id': workspaceId };
}

export interface QrCodeConfigInput {
  name: string;
  format?: QrFormat;
  size?: number;
  foregroundColor?: string;
  backgroundColor?: string;
  errorCorrectionLevel?: QrErrorCorrectionLevel;
  margin?: number;
}

export function createQrCode(
  workspaceId: string,
  linkId: string,
  payload: QrCodeConfigInput,
): Promise<QrCodeDto> {
  return api.post<QrCodeDto>(`/links/${linkId}/qrcodes`, payload, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function listQrCodesForLink(
  workspaceId: string,
  linkId: string,
): Promise<QrCodeDto[]> {
  return api.get<QrCodeDto[]>(`/links/${linkId}/qrcodes`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export interface ListQrCodesParams {
  page?: number;
  pageSize?: number;
  search?: string;
  linkId?: string;
}

export function listQrCodes(
  workspaceId: string,
  params: ListQrCodesParams = {},
): Promise<PaginatedQrCodesDto> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.search) query.set('search', params.search);
  if (params.linkId) query.set('linkId', params.linkId);
  const qs = query.toString();
  return api.get<PaginatedQrCodesDto>(`/qrcodes${qs ? `?${qs}` : ''}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function getQrCode(
  workspaceId: string,
  qrId: string,
): Promise<QrCodeDto> {
  return api.get<QrCodeDto>(`/qrcodes/${qrId}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function updateQrCode(
  workspaceId: string,
  qrId: string,
  payload: Partial<QrCodeConfigInput>,
): Promise<QrCodeDto> {
  return api.patch<QrCodeDto>(`/qrcodes/${qrId}`, payload, {
    headers: workspaceHeaders(workspaceId),
  });
}

export function deleteQrCode(workspaceId: string, qrId: string): Promise<void> {
  return api.delete<void>(`/qrcodes/${qrId}`, {
    headers: workspaceHeaders(workspaceId),
  });
}

/**
 * Downloads always go through a real browser navigation-style fetch
 * (not the generic JSON api client) since the response is binary/text
 * image data, not JSON. Returns an object URL the caller is responsible
 * for revoking after use (see the download button's onClick handler).
 */
export async function downloadQrCode(
  workspaceId: string,
  qrId: string,
  format?: QrFormat,
): Promise<{ blob: Blob; filename: string }> {
  const qs = format ? `?format=${format}` : '';
  const token = getAccessToken();
  const res = await fetch(`${API_URL}/qrcodes/${qrId}/download${qs}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Workspace-Id': workspaceId,
    },
    credentials: 'include',
  });

  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }

  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `qr-code.${(format ?? 'png').toLowerCase()}`;

  const blob = await res.blob();
  return { blob, filename };
}

/**
 * Fetches the rendered QR image (via the authenticated download endpoint)
 * and returns a local object URL suitable for an <img src>. Used for
 * previews on the QR list/detail pages — a plain <img src="/qrcodes/:id/download">
 * would work for the bytes themselves, but browsers can't attach an
 * Authorization header to a bare <img> tag, so the fetch has to happen
 * here in JS first. The caller is responsible for revoking the returned
 * URL (URL.revokeObjectURL) when it's no longer needed, e.g. on unmount.
 */
export async function getQrPreviewObjectUrl(
  workspaceId: string,
  qrId: string,
  format?: QrFormat,
): Promise<string> {
  const { blob } = await downloadQrCode(workspaceId, qrId, format);
  return URL.createObjectURL(blob);
}
