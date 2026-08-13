export const PAYSTACK_WEBHOOK_QUEUE = 'paystack-webhook-events';
export const PROCESS_PAYSTACK_WEBHOOK_JOB = 'process-paystack-webhook';

/** Deliberately just the BillingEvent id (same "tiny job payload, processor
 * reloads from Postgres" convention as webhook-deliveries/click-events/
 * api-usage) — Postgres, not the job, stays the single source of truth
 * for what was received. */
export interface ProcessPaystackWebhookJobData {
  billingEventId: string;
}
