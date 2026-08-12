import { Injectable, Logger } from '@nestjs/common';
import { BillingEventStatus, type BillingEvent, type Prisma } from '@prisma/client';

import { isUniqueConstraintViolation } from '../../common/utils/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordEventInput {
  provider: string;
  externalEventId: string;
  eventType: string;
  payload?: Prisma.InputJsonValue;
}

/**
 * The idempotency ledger for inbound billing-provider events (webhooks).
 * No real webhook HTTP endpoint exists yet — see billing-provider
 * interface docs — so nothing calls this from a live receiver this
 * sprint, but the guarantee it provides (a duplicate delivery is a
 * harmless no-op, never a duplicate row or duplicate processing) is
 * exactly what a future receiver needs, and is proven by unit tests
 * calling `recordEvent` twice with the same `externalEventId`.
 */
@Injectable()
export class BillingEventsService {
  private readonly logger = new Logger(BillingEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a newly-received event. Returns the event and whether this
   * call actually created it (`isNew: false` means a row for this
   * `(provider, externalEventId)` already existed — the caller should
   * skip re-processing, not treat it as an error).
   */
  async recordEvent(
    input: RecordEventInput,
  ): Promise<{ event: BillingEvent; isNew: boolean }> {
    try {
      const event = await this.prisma.billingEvent.create({
        data: {
          provider: input.provider,
          externalEventId: input.externalEventId,
          eventType: input.eventType,
          payload: input.payload,
          status: BillingEventStatus.PENDING,
        },
      });
      return { event, isNew: true };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        this.logger.debug(
          `Duplicate billing event ignored: ${input.provider}/${input.externalEventId}`,
        );
        const existing = await this.prisma.billingEvent.findUniqueOrThrow({
          where: {
            provider_externalEventId: {
              provider: input.provider,
              externalEventId: input.externalEventId,
            },
          },
        });
        return { event: existing, isNew: false };
      }
      throw error;
    }
  }

  async markProcessed(eventId: string): Promise<void> {
    await this.prisma.billingEvent.update({
      where: { id: eventId },
      data: { status: BillingEventStatus.PROCESSED, processedAt: new Date() },
    });
  }

  async markFailed(eventId: string, errorMessage: string): Promise<void> {
    await this.prisma.billingEvent.update({
      where: { id: eventId },
      data: {
        status: BillingEventStatus.FAILED,
        processedAt: new Date(),
        errorMessage,
      },
    });
  }
}
