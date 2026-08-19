import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  BillingEventStatus,
  InvoiceStatus,
  SubscriptionStatus,
  WebhookEventType,
  type BillingEvent,
} from '@prisma/client';
import type { Job } from 'bullmq';

import { AuditService } from '../../../../audit/audit.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RoleResolutionService } from '../../../../roles/role-resolution.service';
import { WebhookEventsService } from '../../../../webhooks/webhook-events.service';
import { BillingEventsService } from '../../../billing-events.service';
import { InvoicesService } from '../../../invoices.service';
import { PlansService } from '../../../plans.service';
import { SubscriptionsService } from '../../../subscriptions.service';
import { packSubscriptionId } from '../paystack-billing.provider';

import {
  PAYSTACK_WEBHOOK_QUEUE,
  type ProcessPaystackWebhookJobData,
} from './paystack-webhook.types';

const SUBSCRIPTION_WITH_PLAN_INCLUDE = {
  plan: {
    include: {
      limits: true,
      platformRole: { select: { id: true, name: true, slug: true } },
      prices: { include: { currency: true } },
    },
  },
} as const;

interface PaystackMetadata {
  workspaceId?: string;
  planSlug?: string;
  /** Sprint 18A — present when this checkout was initialized via the
   * invoice-first flow (see CreateCheckoutSessionInput.invoiceId). */
  invoiceId?: string;
}

function extractMetadata(data: Record<string, unknown>): PaystackMetadata {
  return (data.metadata as PaystackMetadata | undefined) ?? {};
}

/**
 * Consumes Paystack webhook jobs off the queue and applies the guarded
 * state transitions from §8 of docs/architecture/paystack-integration.md.
 * Loads the BillingEvent fresh from Postgres on every attempt (the job
 * payload is just a billingEventId), the same pattern
 * WebhookDeliveryProcessor (Sprint 9) uses for its own jobs.
 *
 * Failures here are recorded on the BillingEvent row (markFailed) rather
 * than rethrown for BullMQ to retry — unlike WebhookDeliveryProcessor's
 * outbound HTTP calls, a correlation/data-shape failure here won't be
 * fixed by simply trying again, so retrying would just burn attempts on
 * an already-durable, ops-visible failure.
 *
 * Correlation strategy (documented limitation — see
 * docs/architecture/paystack-integration.md §Security): Paystack does not
 * confirm a wrapper-level unique event id or guarantee every event
 * payload echoes back the `metadata` set at transaction-initialize time.
 * `charge.success` is the most trustworthy signal (LinkIQ set its own
 * metadata.workspaceId there) and is used to resolve+stamp
 * providerCustomerId onto the Subscription row; every subsequent event
 * for that Paystack customer correlates via providerCustomerId. This is
 * an approximation, not a cryptographic guarantee — flagged, not hidden.
 */
@Processor(PAYSTACK_WEBHOOK_QUEUE, { concurrency: 5 })
@Injectable()
export class PaystackWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(PaystackWebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billingEvents: BillingEventsService,
    private readonly invoices: InvoicesService,
    private readonly plans: PlansService,
    private readonly audit: AuditService,
    private readonly webhookEvents: WebhookEventsService,
    private readonly roleResolution: RoleResolutionService,
    private readonly subscriptions: SubscriptionsService,
  ) {
    super();
  }

  /** Sprint 15 — re-resolves platformRole for every OWNER of a workspace
   * after a webhook-driven subscription state change. No RequestContext
   * exists for a background job (no ipAddress/userAgent to attribute
   * this to) — syncStoredRole()'s ctx parameter is optional for exactly
   * this caller. See SubscriptionsService.syncOwnerRoles for the
   * request-driven equivalent. */
  private async syncOwnerRoles(workspaceId: string): Promise<void> {
    const owners = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, role: 'OWNER' },
      select: { userId: true },
    });
    await Promise.all(
      owners.map((o) => this.roleResolution.syncStoredRole(o.userId)),
    );
  }

  async process(job: Job<ProcessPaystackWebhookJobData>): Promise<void> {
    const { billingEventId } = job.data;

    const billingEvent = await this.prisma.billingEvent.findUnique({
      where: { id: billingEventId },
    });
    if (!billingEvent) {
      this.logger.warn(
        `Discarding Paystack webhook job for missing billing event ${billingEventId}`,
      );
      return;
    }
    if (billingEvent.status === BillingEventStatus.PROCESSED) {
      return;
    }

    try {
      await this.handle(billingEvent);
      await this.billingEvents.markProcessed(billingEvent.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to process Paystack billing event ${billingEvent.id} (${billingEvent.eventType}): ${message}`,
      );
      await this.billingEvents.markFailed(billingEvent.id, message);
    }
  }

  private async handle(billingEvent: BillingEvent): Promise<void> {
    const payload = billingEvent.payload as {
      data?: Record<string, unknown>;
    } | null;
    const data = payload?.data ?? {};

    switch (billingEvent.eventType) {
      case 'charge.success':
        return this.handleChargeSuccess(data);
      case 'subscription.create':
        return this.handleSubscriptionCreate(data);
      case 'subscription.disable':
        return this.handleSubscriptionDisable(data);
      case 'invoice.payment_failed':
        return this.handleInvoicePaymentFailed(data);
      default:
        this.logger.debug(
          `No state-transition handler for Paystack event type "${billingEvent.eventType}" — recorded only.`,
        );
    }
  }

  /**
   * Confirms a payment. Sprint 18A — first tries the invoice-first
   * path: SubscriptionsService.confirmAndActivate, the SAME shared,
   * idempotent function the checkout-callback route calls, correlated
   * via metadata.invoiceId (or the reference itself, if
   * proceedToPayment already attached it). When that returns no
   * correlated invoice at all (a transaction that never went through
   * the invoice-first flow — e.g. this webhook races ahead of
   * proceedToPayment's own attachProviderReference call, or a legacy/
   * test payload with only workspaceId+planSlug metadata), falls back
   * to the original direct-apply logic below, preserving this
   * processor's pre-Sprint-18A behavior exactly for that case.
   */
  private async handleChargeSuccess(
    data: Record<string, unknown>,
  ): Promise<void> {
    const reference =
      typeof data.reference === 'string' ? data.reference : undefined;
    const amount = typeof data.amount === 'number' ? data.amount : undefined;
    const currency = typeof data.currency === 'string' ? data.currency : 'NGN';
    const customer = data.customer as { customer_code?: string } | undefined;
    const customerCode = customer?.customer_code;

    if (reference && amount !== undefined) {
      const rawMetadata =
        (data.metadata as Record<string, unknown> | undefined) ?? null;
      const result = await this.subscriptions.confirmAndActivate({
        reference,
        status: 'success',
        amountKobo: amount,
        currency,
        customerCode: customerCode ?? null,
        metadata: rawMetadata,
      });
      if (result.invoice) {
        // Handled entirely by the shared function — including audit,
        // outbound webhook emit, and role sync (applied:false on a
        // repeat delivery is the intended idempotent no-op).
        return;
      }
    }

    const { workspaceId, planSlug } = extractMetadata(data);

    if (!workspaceId || !planSlug || !customerCode) {
      this.logger.warn(
        'charge.success is missing metadata.workspaceId/planSlug or customer.customer_code — cannot correlate, skipping',
      );
      return;
    }

    const plan = await this.plans.getBySlug(planSlug);
    const now = new Date();

    let subscription;
    try {
      subscription = await this.prisma.subscription.update({
        where: { workspaceId },
        data: {
          planId: plan.id,
          status: SubscriptionStatus.ACTIVE,
          provider: 'paystack',
          providerCustomerId: customerCode,
          currentPeriodStart: now,
          pastDueSince: null,
          cancelAt: null,
          canceledAt: null,
          // Sprint 17 — a real, confirmed charge means this workspace is
          // no longer "currently trialing," regardless of which path
          // (converting an existing trial, or SubscriptionsService
          // routing a non-trial-eligible upgrade straight to checkout)
          // led here. trialUsed is deliberately NOT set here: it's only
          // ever true because a trial actually started (see
          // Subscription.trialUsed's own docs), which SubscriptionsService
          // already recorded before this webhook could fire.
          trialStart: null,
          trialEnd: null,
          // Sprint 16 — the REAL currency/amount Paystack actually
          // charged, straight off the webhook payload, not re-derived
          // from LinkIQ's own Plan/PlanPrice rows (which could have
          // changed since checkout was initiated). This is the
          // authoritative write for a real-provider subscription; the
          // dev-flow apply path in SubscriptionsService.subscribe sets
          // the same fields for the no-provider case.
          ...(amount !== undefined ? { amount, currency } : {}),
        },
        include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
      });
    } catch {
      throw new Error(
        `charge.success for workspace ${workspaceId} but no Subscription row exists for it`,
      );
    }

    if (reference && amount !== undefined) {
      await this.invoices.recordProviderInvoice({
        workspaceId,
        subscriptionId: subscription.id,
        amount,
        currency,
        status: InvoiceStatus.PAID,
        provider: 'paystack',
        providerInvoiceId: reference,
        paidAt: now,
      });
    }

    await this.audit.record({
      action: 'billing.payment_succeeded',
      entity: 'Subscription',
      entityId: subscription.id,
      workspaceId,
      metadata: { planSlug, reference: reference ?? null },
    });

    await this.syncOwnerRoles(workspaceId);
  }

  /** Fills in providerSubscriptionId/providerPriceId/currentPeriodEnd once
   * Paystack confirms the recurring subscription itself — a separate
   * event from charge.success. Emits SUBSCRIPTION_CREATED: for a
   * real-provider checkout, SubscriptionsService.subscribe() deliberately
   * does NOT emit it (nothing is applied until this webhook confirms it),
   * so this is the one and only place it fires for that path. */
  private async handleSubscriptionCreate(
    data: Record<string, unknown>,
  ): Promise<void> {
    const subscriptionCode =
      typeof data.subscription_code === 'string'
        ? data.subscription_code
        : undefined;
    const emailToken =
      typeof data.email_token === 'string' ? data.email_token : undefined;
    if (!subscriptionCode || !emailToken) {
      this.logger.warn(
        'subscription.create is missing subscription_code/email_token — skipping',
      );
      return;
    }

    const { workspaceId } = extractMetadata(data);
    const customer = data.customer as { customer_code?: string } | undefined;
    const customerCode = customer?.customer_code;
    const plan = data.plan as { plan_code?: string } | undefined;
    const nextPaymentDate =
      typeof data.next_payment_date === 'string'
        ? new Date(data.next_payment_date)
        : null;

    const existing = workspaceId
      ? await this.prisma.subscription.findUnique({ where: { workspaceId } })
      : customerCode
        ? await this.prisma.subscription.findFirst({
            where: { providerCustomerId: customerCode },
          })
        : null;

    if (!existing) {
      throw new Error(
        `subscription.create for Paystack subscription ${subscriptionCode} could not be correlated to a LinkIQ workspace (no metadata.workspaceId and no matching providerCustomerId)`,
      );
    }

    const updated = await this.prisma.subscription.update({
      where: { workspaceId: existing.workspaceId },
      data: {
        provider: 'paystack',
        providerSubscriptionId: packSubscriptionId(
          subscriptionCode,
          emailToken,
        ),
        providerPriceId: plan?.plan_code ?? null,
        ...(nextPaymentDate ? { currentPeriodEnd: nextPaymentDate } : {}),
      },
      include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
    });

    await this.audit.record({
      action: 'billing.subscription_activated',
      entity: 'Subscription',
      entityId: updated.id,
      workspaceId: updated.workspaceId,
      metadata: { subscriptionCode },
    });

    await this.webhookEvents.emit({
      type: WebhookEventType.SUBSCRIPTION_CREATED,
      workspaceId: updated.workspaceId,
      resourceId: updated.id,
      data: {
        id: updated.id,
        planSlug: updated.plan.slug,
        status: updated.status,
        trialing: false,
      },
    });

    await this.syncOwnerRoles(updated.workspaceId);
  }

  /** subscription.disable fires both for a LinkIQ-initiated cancel()
   * (which already set cancelAt/canceledAt — this is just Paystack's
   * confirmation echo, a no-op here) and for a Paystack/system-initiated
   * disable LinkIQ didn't ask for (auto-disable after repeated failures),
   * which DOES need to flip LinkIQ's own state. */
  private async handleSubscriptionDisable(
    data: Record<string, unknown>,
  ): Promise<void> {
    const subscriptionCode =
      typeof data.subscription_code === 'string'
        ? data.subscription_code
        : undefined;
    if (!subscriptionCode) {
      this.logger.warn(
        'subscription.disable is missing subscription_code — skipping',
      );
      return;
    }

    // Guard (§8 of the plan): only ever applies to the subscription that
    // CURRENTLY holds this exact code — a stale/superseded event for an
    // id no longer stored here is silently ignored, not applied.
    const existing = await this.prisma.subscription.findFirst({
      where: { providerSubscriptionId: { startsWith: `${subscriptionCode}:` } },
    });

    if (!existing) {
      this.logger.debug(
        `subscription.disable for ${subscriptionCode} does not match any currently-stored subscription — ignoring (likely superseded by a later checkout)`,
      );
      return;
    }

    if (existing.cancelAt) {
      return;
    }

    const now = new Date();
    const updated = await this.prisma.subscription.update({
      where: { workspaceId: existing.workspaceId },
      data: { cancelAt: now, canceledAt: now },
      include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
    });

    await this.audit.record({
      action: 'billing.subscription_disabled',
      entity: 'Subscription',
      entityId: updated.id,
      workspaceId: updated.workspaceId,
      metadata: { subscriptionCode, initiatedByProvider: true },
    });

    await this.webhookEvents.emit({
      type: WebhookEventType.SUBSCRIPTION_CANCELED,
      workspaceId: updated.workspaceId,
      resourceId: updated.id,
      data: { id: updated.id, cancelAt: now.toISOString() },
    });

    await this.syncOwnerRoles(updated.workspaceId);
  }

  /** No outbound WebhookEventType maps to "payment failed" — recorded via
   * audit + an UNCOLLECTIBLE Invoice row, no outbound emit this sprint
   * (a documented simplification, not a silent gap). */
  private async handleInvoicePaymentFailed(
    data: Record<string, unknown>,
  ): Promise<void> {
    const customer = data.customer as { customer_code?: string } | undefined;
    const customerCode = customer?.customer_code;
    if (!customerCode) {
      this.logger.warn(
        'invoice.payment_failed is missing customer.customer_code — skipping',
      );
      return;
    }

    const existing = await this.prisma.subscription.findFirst({
      where: { providerCustomerId: customerCode },
    });
    if (!existing) {
      this.logger.warn(
        `invoice.payment_failed for unrecognized Paystack customer ${customerCode} — skipping`,
      );
      return;
    }

    const amount = typeof data.amount === 'number' ? data.amount : 0;
    const currency = typeof data.currency === 'string' ? data.currency : 'NGN';
    const failureReason =
      typeof data.gateway_response === 'string'
        ? data.gateway_response
        : 'Payment failed';
    const now = new Date();

    const updated = await this.prisma.subscription.update({
      where: { workspaceId: existing.workspaceId },
      data: {
        status: SubscriptionStatus.PAST_DUE,
        // Preserve the original failure time across repeated failed
        // attempts — the grace period counts from the FIRST failure, not
        // reset on every subsequent one.
        pastDueSince: existing.pastDueSince ?? now,
      },
    });

    await this.invoices.recordProviderInvoice({
      workspaceId: updated.workspaceId,
      subscriptionId: updated.id,
      amount,
      currency,
      status: InvoiceStatus.UNCOLLECTIBLE,
      provider: 'paystack',
      failureReason,
    });

    await this.audit.record({
      action: 'billing.payment_failed',
      entity: 'Subscription',
      entityId: updated.id,
      workspaceId: updated.workspaceId,
      metadata: { failureReason },
    });

    // PAST_DUE is still "effectively on plan" (isEffectivelyOnPlan) —
    // this is a no-op today, called for symmetry with the other three
    // handlers and to correctly downgrade the role once the PAST_DUE
    // grace period is exceeded and something next reads/syncs this
    // workspace's owner (see getEffectiveStatus's PAST_DUE -> EXPIRED
    // branch).
    await this.syncOwnerRoles(updated.workspaceId);
  }
}
