import { WebhookEventType } from '@prisma/client';

/**
 * The single source of truth mapping Prisma's SCREAMING_SNAKE
 * WebhookEventType values to the dotted wire strings ("link.created")
 * every webhook payload's `type` field and every endpoint's `events`
 * request/response JSON actually uses. A Prisma enum can't contain dots,
 * so this lookup is what lets WebhookEndpoint.events stay a real,
 * indexable Postgres array (same shape as Sprint 8's ApiKeyPermission[])
 * while the public API surface speaks the spec's exact dotted format.
 *
 * WEBHOOK_TEST is deliberately excluded from PUBLIC_EVENT_TYPES — it is
 * never a subscribable event, only ever sent by the "send test event"
 * endpoint (see webhooks.controller.ts), and is clearly identifiable as
 * `webhook.test` in the payload so a receiver can never mistake it for a
 * real domain event.
 */
export const EVENT_TYPE_WIRE_NAME: Record<WebhookEventType, string> = {
  LINK_CREATED: 'link.created',
  LINK_UPDATED: 'link.updated',
  LINK_DELETED: 'link.deleted',
  LINK_PAUSED: 'link.paused',
  LINK_ACTIVATED: 'link.activated',
  LINK_ARCHIVED: 'link.archived',
  LINK_CLICKED: 'link.clicked',
  QRCODE_CREATED: 'qrcode.created',
  QRCODE_UPDATED: 'qrcode.updated',
  QRCODE_DELETED: 'qrcode.deleted',
  CAMPAIGN_CREATED: 'campaign.created',
  CAMPAIGN_UPDATED: 'campaign.updated',
  CAMPAIGN_DELETED: 'campaign.deleted',
  CAMPAIGN_ACTIVATED: 'campaign.activated',
  CAMPAIGN_PAUSED: 'campaign.paused',
  CAMPAIGN_ARCHIVED: 'campaign.archived',
  DOMAIN_CREATED: 'domain.created',
  DOMAIN_VERIFIED: 'domain.verified',
  DOMAIN_ACTIVATED: 'domain.activated',
  DOMAIN_DISABLED: 'domain.disabled',
  DOMAIN_DELETED: 'domain.deleted',
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_PLAN_CHANGED: 'subscription.plan_changed',
  SUBSCRIPTION_CANCELED: 'subscription.canceled',
  SUBSCRIPTION_REACTIVATED: 'subscription.reactivated',
  BILLING_LIMIT_REACHED: 'billing.limit_reached',
  API_KEY_CREATED: 'api_key.created',
  API_KEY_REVOKED: 'api_key.revoked',
  API_KEY_DELETED: 'api_key.deleted',
  WEBHOOK_TEST: 'webhook.test',
};

export const WIRE_NAME_TO_EVENT_TYPE: Record<string, WebhookEventType> =
  Object.fromEntries(
    Object.entries(EVENT_TYPE_WIRE_NAME).map(([key, value]) => [
      value,
      key as WebhookEventType,
    ]),
  );

/** Every event a workspace can actually subscribe to — excludes
 * WEBHOOK_TEST, which is never subscribable (see class docs above). */
export const SUBSCRIBABLE_EVENT_TYPES: WebhookEventType[] = Object.values(
  WebhookEventType,
).filter((type) => type !== WebhookEventType.WEBHOOK_TEST);

export const SUBSCRIBABLE_WIRE_NAMES: string[] = SUBSCRIBABLE_EVENT_TYPES.map(
  (type) => EVENT_TYPE_WIRE_NAME[type],
);
