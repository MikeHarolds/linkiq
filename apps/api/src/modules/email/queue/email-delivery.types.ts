export const EMAIL_QUEUE = 'email-deliveries';
export const SEND_EMAIL_JOB = 'send-email';

/**
 * Deliberately just the log id — same discipline as
 * webhooks/queue/webhook-delivery.types.ts: the processor reloads the
 * EmailLog (including its `metadata` template variables) from Postgres
 * on every attempt, which stays the single source of truth for status.
 */
export interface SendEmailJobData {
  emailLogId: string;
}
