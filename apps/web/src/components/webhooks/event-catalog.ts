import type { WebhookEventTypeName } from '@linkiq/types';

/** Human-readable label for every subscribable event type — kept in sync
 * with the `WebhookEventTypeName` union in packages/types/src/index.ts.
 * `webhook.test` is deliberately excluded: it is never subscribable. */
export const WEBHOOK_EVENT_LABELS: Record<WebhookEventTypeName, string> = {
  'link.created': 'Link created',
  'link.updated': 'Link updated',
  'link.deleted': 'Link deleted',
  'link.paused': 'Link paused',
  'link.activated': 'Link activated',
  'link.archived': 'Link archived',
  'link.clicked': 'Link clicked',
  'qrcode.created': 'QR code created',
  'qrcode.updated': 'QR code updated',
  'qrcode.deleted': 'QR code deleted',
  'campaign.created': 'Campaign created',
  'campaign.updated': 'Campaign updated',
  'campaign.deleted': 'Campaign deleted',
  'campaign.activated': 'Campaign activated',
  'campaign.paused': 'Campaign paused',
  'campaign.archived': 'Campaign archived',
  'domain.created': 'Domain created',
  'domain.verified': 'Domain verified',
  'domain.activated': 'Domain activated',
  'domain.disabled': 'Domain disabled',
  'domain.deleted': 'Domain deleted',
  'subscription.created': 'Subscription created',
  'subscription.plan_changed': 'Subscription plan changed',
  'subscription.canceled': 'Subscription canceled',
  'subscription.reactivated': 'Subscription reactivated',
  'billing.limit_reached': 'Billing limit reached',
  'api_key.created': 'API key created',
  'api_key.revoked': 'API key revoked',
  'api_key.deleted': 'API key deleted',
};

/** Grouped for the create/edit-endpoint dialog's checkbox list — presented
 * by resource rather than as one flat alphabetical list of 29 events. */
export const WEBHOOK_EVENT_GROUPS: {
  label: string;
  events: WebhookEventTypeName[];
}[] = [
  {
    label: 'Links',
    events: [
      'link.created',
      'link.updated',
      'link.deleted',
      'link.paused',
      'link.activated',
      'link.archived',
      'link.clicked',
    ],
  },
  {
    label: 'QR codes',
    events: ['qrcode.created', 'qrcode.updated', 'qrcode.deleted'],
  },
  {
    label: 'Campaigns',
    events: [
      'campaign.created',
      'campaign.updated',
      'campaign.deleted',
      'campaign.activated',
      'campaign.paused',
      'campaign.archived',
    ],
  },
  {
    label: 'Custom domains',
    events: [
      'domain.created',
      'domain.verified',
      'domain.activated',
      'domain.disabled',
      'domain.deleted',
    ],
  },
  {
    label: 'Billing',
    events: [
      'subscription.created',
      'subscription.plan_changed',
      'subscription.canceled',
      'subscription.reactivated',
      'billing.limit_reached',
    ],
  },
  {
    label: 'API keys',
    events: ['api_key.created', 'api_key.revoked', 'api_key.deleted'],
  },
];
