import {
  BillingEventStatus,
  InvoiceStatus,
  SubscriptionStatus,
} from '@prisma/client';
import type { Job } from 'bullmq';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../../../../test/mocks/prisma.mock';
import type { AuditService } from '../../../../audit/audit.service';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { WebhookEventsService } from '../../../../webhooks/webhook-events.service';
import type { BillingEventsService } from '../../../billing-events.service';
import type { InvoicesService } from '../../../invoices.service';
import type { PlansService } from '../../../plans.service';
import { packSubscriptionId } from '../paystack-billing.provider';

import { PaystackWebhookProcessor } from './paystack-webhook.processor';
import type { ProcessPaystackWebhookJobData } from './paystack-webhook.types';

function makeJob(billingEventId: string): Job<ProcessPaystackWebhookJobData> {
  return {
    data: { billingEventId },
  } as unknown as Job<ProcessPaystackWebhookJobData>;
}

function makeBillingEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'billing-event-1',
    provider: 'paystack',
    externalEventId: 'hash-abc',
    eventType: 'charge.success',
    status: BillingEventStatus.PENDING,
    payload: { event: 'charge.success', data: {} },
    ...overrides,
  };
}

function makeSubscription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sub-1',
    workspaceId: 'ws-1',
    planId: 'plan-starter',
    status: SubscriptionStatus.ACTIVE,
    currentPeriodStart: new Date('2026-01-01'),
    currentPeriodEnd: new Date('2026-02-01'),
    trialStart: null,
    trialEnd: null,
    cancelAt: null,
    canceledAt: null,
    pastDueSince: null,
    provider: null,
    providerCustomerId: null,
    providerSubscriptionId: null,
    providerPriceId: null,
    plan: { slug: 'starter' },
    ...overrides,
  };
}

describe('PaystackWebhookProcessor', () => {
  let prisma: MockPrismaService;
  let billingEvents: jest.Mocked<
    Pick<BillingEventsService, 'markProcessed' | 'markFailed'>
  >;
  let invoices: jest.Mocked<Pick<InvoicesService, 'recordProviderInvoice'>>;
  let plans: jest.Mocked<Pick<PlansService, 'getBySlug'>>;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let webhookEvents: jest.Mocked<Pick<WebhookEventsService, 'emit'>>;
  let processor: PaystackWebhookProcessor;

  beforeEach(() => {
    prisma = createMockPrismaService();
    billingEvents = {
      markProcessed: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    invoices = {
      recordProviderInvoice: jest.fn().mockResolvedValue({ id: 'inv-1' }),
    };
    plans = { getBySlug: jest.fn() };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    webhookEvents = { emit: jest.fn().mockResolvedValue(undefined) };
    processor = new PaystackWebhookProcessor(
      prisma as unknown as PrismaService,
      billingEvents as unknown as BillingEventsService,
      invoices as unknown as InvoicesService,
      plans as unknown as PlansService,
      audit as unknown as AuditService,
      webhookEvents as unknown as WebhookEventsService,
    );
  });

  it('discards the job when the billing event no longer exists', async () => {
    prisma.billingEvent.findUnique.mockResolvedValue(null);

    await processor.process(makeJob('missing'));

    expect(billingEvents.markProcessed).not.toHaveBeenCalled();
  });

  it('no-ops when the billing event is already PROCESSED', async () => {
    prisma.billingEvent.findUnique.mockResolvedValue(
      makeBillingEvent({ status: BillingEventStatus.PROCESSED }),
    );

    await processor.process(makeJob('billing-event-1'));

    expect(billingEvents.markProcessed).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('marks the event FAILED (not rethrown) when the handler throws', async () => {
    prisma.billingEvent.findUnique.mockResolvedValue(
      makeBillingEvent({
        payload: {
          event: 'charge.success',
          data: {
            metadata: { workspaceId: 'ws-1', planSlug: 'starter' },
            customer: { customer_code: 'CUS_1' },
          },
        },
      }),
    );
    plans.getBySlug.mockResolvedValue({
      id: 'plan-starter',
      slug: 'starter',
    } as never);
    prisma.subscription.update.mockRejectedValue(new Error('no such row'));

    await expect(
      processor.process(makeJob('billing-event-1')),
    ).resolves.toBeUndefined();

    expect(billingEvents.markFailed).toHaveBeenCalledWith(
      'billing-event-1',
      expect.stringContaining('charge.success for workspace ws-1'),
    );
    expect(billingEvents.markProcessed).not.toHaveBeenCalled();
  });

  describe('charge.success', () => {
    function eventWith(data: Record<string, unknown>) {
      return makeBillingEvent({
        eventType: 'charge.success',
        payload: { event: 'charge.success', data },
      });
    }

    it('skips (does not throw) when metadata/customer_code is missing', async () => {
      prisma.billingEvent.findUnique.mockResolvedValue(eventWith({}));

      await processor.process(makeJob('billing-event-1'));

      expect(billingEvents.markProcessed).toHaveBeenCalledWith(
        'billing-event-1',
      );
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('activates the subscription, stamps providerCustomerId, and records an invoice', async () => {
      prisma.billingEvent.findUnique.mockResolvedValue(
        eventWith({
          metadata: { workspaceId: 'ws-1', planSlug: 'starter' },
          customer: { customer_code: 'CUS_abc' },
          reference: 'txn-abc',
          amount: 190000,
          currency: 'USD',
        }),
      );
      plans.getBySlug.mockResolvedValue({
        id: 'plan-starter',
        slug: 'starter',
      } as never);
      prisma.subscription.update.mockResolvedValue(makeSubscription());

      await processor.process(makeJob('billing-event-1'));

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'ws-1' },
          data: expect.objectContaining({
            planId: 'plan-starter',
            status: SubscriptionStatus.ACTIVE,
            provider: 'paystack',
            providerCustomerId: 'CUS_abc',
            pastDueSince: null,
          }),
        }),
      );
      expect(invoices.recordProviderInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-1',
          amount: 190000,
          status: InvoiceStatus.PAID,
          providerInvoiceId: 'txn-abc',
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.payment_succeeded' }),
      );
      expect(billingEvents.markProcessed).toHaveBeenCalledWith(
        'billing-event-1',
      );
    });
  });

  describe('subscription.create', () => {
    function eventWith(data: Record<string, unknown>) {
      return makeBillingEvent({
        eventType: 'subscription.create',
        payload: { event: 'subscription.create', data },
      });
    }

    it('correlates via metadata.workspaceId, packs the subscription id, and emits SUBSCRIPTION_CREATED', async () => {
      prisma.billingEvent.findUnique.mockResolvedValue(
        eventWith({
          subscription_code: 'SUB_abc',
          email_token: 'tok_abc',
          metadata: { workspaceId: 'ws-1' },
          customer: { customer_code: 'CUS_abc' },
          plan: { plan_code: 'PLN_starter' },
          next_payment_date: '2026-09-13T10:00:00.000Z',
        }),
      );
      prisma.subscription.findUnique.mockResolvedValue(makeSubscription());
      prisma.subscription.update.mockResolvedValue(makeSubscription());

      await processor.process(makeJob('billing-event-1'));

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'ws-1' },
          data: expect.objectContaining({
            provider: 'paystack',
            providerSubscriptionId: packSubscriptionId('SUB_abc', 'tok_abc'),
            providerPriceId: 'PLN_starter',
            currentPeriodEnd: new Date('2026-09-13T10:00:00.000Z'),
          }),
        }),
      );
      expect(webhookEvents.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SUBSCRIPTION_CREATED',
          workspaceId: 'ws-1',
        }),
      );
      expect(billingEvents.markProcessed).toHaveBeenCalledWith(
        'billing-event-1',
      );
    });

    it('falls back to providerCustomerId correlation when metadata is absent', async () => {
      prisma.billingEvent.findUnique.mockResolvedValue(
        eventWith({
          subscription_code: 'SUB_abc',
          email_token: 'tok_abc',
          customer: { customer_code: 'CUS_abc' },
        }),
      );
      prisma.subscription.findFirst.mockResolvedValue(makeSubscription());
      prisma.subscription.update.mockResolvedValue(makeSubscription());

      await processor.process(makeJob('billing-event-1'));

      expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
        where: { providerCustomerId: 'CUS_abc' },
      });
      expect(prisma.subscription.update).toHaveBeenCalled();
    });

    it('fails (markFailed) when no correlation is possible', async () => {
      prisma.billingEvent.findUnique.mockResolvedValue(
        eventWith({ subscription_code: 'SUB_abc', email_token: 'tok_abc' }),
      );

      await processor.process(makeJob('billing-event-1'));

      expect(billingEvents.markFailed).toHaveBeenCalledWith(
        'billing-event-1',
        expect.stringContaining('could not be correlated'),
      );
    });
  });

  describe('subscription.disable', () => {
    function eventWith(data: Record<string, unknown>) {
      return makeBillingEvent({
        eventType: 'subscription.disable',
        payload: { event: 'subscription.disable', data },
      });
    }

    it('ignores an event whose subscription_code no longer matches any stored subscription (stale/superseded guard)', async () => {
      prisma.billingEvent.findUnique.mockResolvedValue(
        eventWith({ subscription_code: 'SUB_stale' }),
      );
      prisma.subscription.findFirst.mockResolvedValue(null);

      await processor.process(makeJob('billing-event-1'));

      expect(prisma.subscription.update).not.toHaveBeenCalled();
      expect(billingEvents.markProcessed).toHaveBeenCalledWith(
        'billing-event-1',
      );
    });

    it('is a no-op when cancelAt is already set (LinkIQ-initiated cancel, this is just the confirmation echo)', async () => {
      prisma.billingEvent.findUnique.mockResolvedValue(
        eventWith({ subscription_code: 'SUB_abc' }),
      );
      prisma.subscription.findFirst.mockResolvedValue(
        makeSubscription({
          cancelAt: new Date(),
          providerSubscriptionId: packSubscriptionId('SUB_abc', 'tok_abc'),
        }),
      );

      await processor.process(makeJob('billing-event-1'));

      expect(prisma.subscription.update).not.toHaveBeenCalled();
      expect(webhookEvents.emit).not.toHaveBeenCalled();
    });

    it('applies cancelAt/canceledAt and emits SUBSCRIPTION_CANCELED for a provider-initiated disable', async () => {
      prisma.billingEvent.findUnique.mockResolvedValue(
        eventWith({ subscription_code: 'SUB_abc' }),
      );
      prisma.subscription.findFirst.mockResolvedValue(
        makeSubscription({
          cancelAt: null,
          providerSubscriptionId: packSubscriptionId('SUB_abc', 'tok_abc'),
        }),
      );
      prisma.subscription.update.mockResolvedValue(makeSubscription());

      await processor.process(makeJob('billing-event-1'));

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelAt: expect.any(Date),
            canceledAt: expect.any(Date),
          }),
        }),
      );
      expect(webhookEvents.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SUBSCRIPTION_CANCELED' }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.subscription_disabled' }),
      );
    });
  });

  describe('invoice.payment_failed', () => {
    function eventWith(data: Record<string, unknown>) {
      return makeBillingEvent({
        eventType: 'invoice.payment_failed',
        payload: { event: 'invoice.payment_failed', data },
      });
    }

    it('skips when customer_code is missing', async () => {
      prisma.billingEvent.findUnique.mockResolvedValue(eventWith({}));

      await processor.process(makeJob('billing-event-1'));

      expect(prisma.subscription.update).not.toHaveBeenCalled();
      expect(billingEvents.markProcessed).toHaveBeenCalledWith(
        'billing-event-1',
      );
    });

    it('sets PAST_DUE, records an UNCOLLECTIBLE invoice, and preserves an existing pastDueSince', async () => {
      const originalFailureTime = new Date('2026-08-01T00:00:00.000Z');
      prisma.billingEvent.findUnique.mockResolvedValue(
        eventWith({
          customer: { customer_code: 'CUS_abc' },
          amount: 190000,
          currency: 'USD',
          gateway_response: 'Insufficient funds',
        }),
      );
      prisma.subscription.findFirst.mockResolvedValue(
        makeSubscription({ pastDueSince: originalFailureTime }),
      );
      prisma.subscription.update.mockResolvedValue(
        makeSubscription({ status: SubscriptionStatus.PAST_DUE }),
      );

      await processor.process(makeJob('billing-event-1'));

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SubscriptionStatus.PAST_DUE,
            pastDueSince: originalFailureTime,
          }),
        }),
      );
      expect(invoices.recordProviderInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          status: InvoiceStatus.UNCOLLECTIBLE,
          failureReason: 'Insufficient funds',
        }),
      );
    });

    it('sets pastDueSince to now when this is the first failure', async () => {
      prisma.billingEvent.findUnique.mockResolvedValue(
        eventWith({ customer: { customer_code: 'CUS_abc' } }),
      );
      prisma.subscription.findFirst.mockResolvedValue(
        makeSubscription({ pastDueSince: null }),
      );
      prisma.subscription.update.mockResolvedValue(makeSubscription());

      await processor.process(makeJob('billing-event-1'));

      const updateCall = prisma.subscription.update.mock.calls[0][0];
      expect(updateCall.data.pastDueSince).toBeInstanceOf(Date);
    });
  });

  describe('unhandled event types', () => {
    it('marks the event PROCESSED without touching any state (recorded only)', async () => {
      prisma.billingEvent.findUnique.mockResolvedValue(
        makeBillingEvent({
          eventType: 'refund.processed',
          payload: { event: 'refund.processed', data: {} },
        }),
      );

      await processor.process(makeJob('billing-event-1'));

      expect(prisma.subscription.update).not.toHaveBeenCalled();
      expect(billingEvents.markProcessed).toHaveBeenCalledWith(
        'billing-event-1',
      );
    });
  });
});
