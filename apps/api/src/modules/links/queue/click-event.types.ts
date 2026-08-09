export const CLICK_EVENT_QUEUE = 'link-clicks';
export const RECORD_CLICK_JOB = 'record-click';

export interface RecordClickJobData {
  linkId: string;
  workspaceId: string;
  occurredAt: string; // ISO string — job payloads are serialized to JSON
  ipAddress?: string;
  userAgent?: string;
  referer?: string;
}
