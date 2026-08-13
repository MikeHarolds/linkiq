import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WebhookDeliveryStatus,
  WebhookEndpointStatus,
} from '@prisma/client';
import type { Job } from 'bullmq';

import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EVENT_TYPE_WIRE_NAME } from '../event-catalog';
import { WebhookSecretCipherService } from '../security/webhook-secret-cipher.service';
import { WebhookUrlGuard } from '../security/webhook-url-guard';
import { WebhookSignatureService } from '../webhook-signature.service';

import {
  WEBHOOK_DELIVERY_QUEUE,
  type DeliverWebhookJobData,
} from './webhook-delivery.types';

/** Network error, timeout, or a status code where the receiver told us
 * (or strongly implied) "try again later" — everything else is
 * permanent. Matches docs/architecture/webhooks.md §Retries. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Consumes webhook delivery jobs off the queue and performs the actual
 * outbound HTTP call — the ONLY place in the codebase that does. Loads
 * the delivery, its endpoint, and its event fresh from Postgres on every
 * attempt (the job payload is just a `deliveryId`, per
 * webhook-delivery.types.ts) so Postgres — not the job — stays the
 * single source of truth for status, and so a pause/disable/secret
 * rotation that happens between enqueue and processing is always
 * respected.
 *
 * Retry/backoff is BullMQ's own `attempts`/`backoff` engine (configured
 * at enqueue time in WebhookDeliveryProducer) — this processor only
 * decides whether to rethrow (schedule the next attempt) or swallow
 * (stop retrying) based on the classification below.
 */
@Processor(WEBHOOK_DELIVERY_QUEUE, {
  // Deliveries are outbound HTTP to arbitrary third parties — bounded
  // concurrency keeps one slow/hanging receiver from starving every
  // other workspace's deliveries.
  concurrency: 10,
})
@Injectable()
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly urlGuard: WebhookUrlGuard,
    private readonly secretCipher: WebhookSecretCipherService,
    private readonly signature: WebhookSignatureService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(job: Job<DeliverWebhookJobData>): Promise<void> {
    const { deliveryId } = job.data;

    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { webhookEndpoint: true, event: true },
    });

    if (!delivery) {
      this.logger.warn(
        `Discarding webhook delivery job for missing delivery ${deliveryId}`,
      );
      return;
    }

    const { webhookEndpoint: endpoint, event } = delivery;

    // Endpoint may have been paused/disabled/deleted since this job was
    // enqueued — no HTTP attempted, no further retry either way.
    if (
      endpoint.status !== WebhookEndpointStatus.ACTIVE ||
      endpoint.deletedAt
    ) {
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: WebhookDeliveryStatus.FAILED,
          failureReason: `Endpoint is ${endpoint.deletedAt ? 'deleted' : endpoint.status.toLowerCase()}`,
          lastAttemptAt: new Date(),
        },
      });
      return;
    }

    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: WebhookDeliveryStatus.PROCESSING },
    });

    // Defense against DNS-rebinding/TOCTOU: the endpoint URL was already
    // validated at create/update time, but re-check immediately before
    // every attempt since DNS can change between then and now.
    try {
      await this.urlGuard.assertSafe(endpoint.url);
    } catch (error) {
      await this.finalizeFailure(delivery.id, endpoint.id, {
        responseStatus: null,
        responseTimeMs: null,
        failureReason: `Blocked destination: ${error instanceof Error ? error.message : String(error)}`,
        retryable: false,
        attemptsMade: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? 1,
      });
      return;
    }

    const rawSecret = this.secretCipher.decrypt(endpoint.secretCiphertext);
    const envelope = {
      id: event.id,
      type: EVENT_TYPE_WIRE_NAME[event.type],
      createdAt: event.createdAt.toISOString(),
      workspaceId: event.workspaceId,
      data: event.payload,
    };
    const body = JSON.stringify(envelope);
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = this.signature.sign(rawSecret, timestamp, body);

    const timeoutMs = this.config.get<number>('webhooks.timeoutMs') ?? 10000;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    const attemptsMade = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;

    let outcome:
      | { kind: 'success'; status: number; responseTimeMs: number }
      | {
          kind: 'failure';
          responseStatus: number | null;
          responseTimeMs: number | null;
          failureReason: string;
          retryable: boolean;
        };

    const startedAt = Date.now();
    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LinkIQ-Event-Id': event.id,
          'X-LinkIQ-Event-Type': envelope.type,
          'X-LinkIQ-Timestamp': String(timestamp),
          'X-LinkIQ-Signature': sig,
        },
        body,
        signal: controller.signal,
      });
      const responseTimeMs = Date.now() - startedAt;

      outcome = response.ok
        ? { kind: 'success', status: response.status, responseTimeMs }
        : {
            kind: 'failure',
            responseStatus: response.status,
            responseTimeMs,
            failureReason: `Receiver responded with HTTP ${response.status}`,
            retryable: isRetryableStatus(response.status),
          };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      outcome = {
        kind: 'failure',
        responseStatus: null,
        responseTimeMs: Date.now() - startedAt,
        failureReason: isAbort
          ? `Request timed out after ${timeoutMs}ms`
          : `Network error: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true, // timeouts and network errors are always retryable
      };
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (outcome.kind === 'success') {
      await this.finalizeSuccess(
        delivery.id,
        endpoint.id,
        outcome.status,
        outcome.responseTimeMs,
      );
      return;
    }

    await this.finalizeFailure(delivery.id, endpoint.id, {
      responseStatus: outcome.responseStatus,
      responseTimeMs: outcome.responseTimeMs,
      failureReason: outcome.failureReason,
      retryable: outcome.retryable,
      attemptsMade,
      maxAttempts,
    });

    if (outcome.retryable && attemptsMade < maxAttempts) {
      // Let BullMQ apply its configured backoff and schedule the next
      // attempt — the delivery row was already left in FAILED (not
      // EXHAUSTED) above since this wasn't the terminal attempt.
      throw new Error(outcome.failureReason);
    }
  }

  private async finalizeSuccess(
    deliveryId: string,
    endpointId: string,
    responseStatus: number,
    responseTimeMs: number,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: WebhookDeliveryStatus.DELIVERED,
          attemptCount: { increment: 1 },
          responseStatus,
          responseTimeMs,
          lastAttemptAt: now,
          deliveredAt: now,
          failureReason: null,
        },
      }),
      this.prisma.webhookEndpoint.update({
        where: { id: endpointId },
        data: {
          consecutiveFailures: 0,
          lastDeliveryAt: now,
          lastSuccessAt: now,
        },
      }),
    ]);
  }

  /**
   * Records this attempt's outcome. If more automatic retries remain
   * (`retryable && attemptsMade < maxAttempts`), the delivery stays
   * `FAILED` (retryable) and the caller rethrows so BullMQ schedules the
   * next attempt. Otherwise this was the terminal attempt — the delivery
   * moves to `EXHAUSTED` and the endpoint's consecutive-failure counter
   * (which drives auto-disable) is incremented exactly once per
   * terminal delivery, not per attempt.
   */
  private async finalizeFailure(
    deliveryId: string,
    endpointId: string,
    outcome: {
      responseStatus: number | null;
      responseTimeMs: number | null;
      failureReason: string;
      retryable: boolean;
      attemptsMade: number;
      maxAttempts: number;
    },
  ): Promise<void> {
    const now = new Date();
    const isTerminal = !outcome.retryable || outcome.attemptsMade >= outcome.maxAttempts;

    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: isTerminal
          ? WebhookDeliveryStatus.EXHAUSTED
          : WebhookDeliveryStatus.FAILED,
        attemptCount: { increment: 1 },
        responseStatus: outcome.responseStatus,
        responseTimeMs: outcome.responseTimeMs,
        lastAttemptAt: now,
        failureReason: outcome.failureReason,
      },
    });

    await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { lastDeliveryAt: now, lastFailureAt: now },
    });

    if (!isTerminal) {
      return;
    }

    const updatedEndpoint = await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { consecutiveFailures: { increment: 1 } },
      select: {
        id: true,
        workspaceId: true,
        consecutiveFailures: true,
        status: true,
      },
    });

    await this.audit.record({
      action: 'webhook.delivery_failed',
      entity: 'WebhookDelivery',
      entityId: deliveryId,
      workspaceId: updatedEndpoint.workspaceId,
      metadata: { endpointId, failureReason: outcome.failureReason },
    });

    const threshold =
      this.config.get<number>('webhooks.autoDisableThreshold') ?? 10;

    if (
      updatedEndpoint.consecutiveFailures >= threshold &&
      updatedEndpoint.status === WebhookEndpointStatus.ACTIVE
    ) {
      await this.prisma.webhookEndpoint.update({
        where: { id: endpointId },
        data: { status: WebhookEndpointStatus.DISABLED },
      });
      await this.audit.record({
        action: 'webhook.disabled',
        entity: 'WebhookEndpoint',
        entityId: endpointId,
        workspaceId: updatedEndpoint.workspaceId,
        metadata: { consecutiveFailures: updatedEndpoint.consecutiveFailures },
      });
    }
  }
}
