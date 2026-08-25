import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';

import {
  EMAIL_QUEUE,
  SEND_EMAIL_JOB,
  type SendEmailJobData,
} from './email-delivery.types';

/**
 * Enqueues email send attempts — structurally identical to
 * webhooks/queue/webhook-delivery.producer.ts: never awaited into the
 * caller's request/response cycle, enqueue failures are logged and
 * swallowed rather than thrown (a down/slow Redis must never break
 * registration, password reset, or any other caller — see
 * EmailService, the only caller).
 */
@Injectable()
export class EmailDeliveryProducer {
  private readonly logger = new Logger(EmailDeliveryProducer.name);

  constructor(
    @InjectQueue(EMAIL_QUEUE)
    private readonly queue: Queue<SendEmailJobData>,
    private readonly config: ConfigService,
  ) {}

  enqueue(data: SendEmailJobData): void {
    const maxAttempts = this.config.get<number>('email.maxAttempts') ?? 5;
    const backoffBaseMs =
      this.config.get<number>('email.backoffBaseMs') ?? 2000;

    this.queue
      .add(SEND_EMAIL_JOB, data, {
        attempts: maxAttempts,
        backoff: { type: 'exponential', delay: backoffBaseMs },
        removeOnComplete: { age: 24 * 60 * 60 },
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to enqueue email delivery ${data.emailLogId}: ${String(error)}`,
        );
      });
  }
}
