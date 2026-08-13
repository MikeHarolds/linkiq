export const WEBHOOK_DELIVERY_QUEUE = 'webhook-deliveries';
export const DELIVER_WEBHOOK_JOB = 'deliver-webhook';

/**
 * Deliberately just the delivery id (§11 of the Sprint 9 spec) — the
 * processor loads the delivery, its endpoint, and its event from
 * Postgres, which stays the single source of truth for delivery state.
 * Keeps jobs tiny regardless of how large an event's payload is.
 */
export interface DeliverWebhookJobData {
  deliveryId: string;
}
