import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EmailLogStatus } from '@prisma/client';
import type { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { EmailConfigService } from '../email-config.service';
import { EmailProviderFactory } from '../providers/email-provider.factory';
import { EmailRendererService } from '../templates/email-renderer.service';

import { EMAIL_QUEUE, type SendEmailJobData } from './email-delivery.types';

/**
 * Consumes email send jobs off the queue and performs the actual
 * outbound call — the ONLY place that does. Loads the EmailLog fresh
 * from Postgres on every attempt (the job payload is just an id, per
 * email-delivery.types.ts), the exact same discipline
 * WebhookDeliveryProcessor uses, so a mid-flight admin disable/
 * reconfigure between enqueue and processing is always respected.
 *
 * Retry/backoff is BullMQ's own `attempts`/`backoff` engine (configured
 * at enqueue time in EmailDeliveryProducer) — this processor only
 * decides whether to rethrow (schedule the next attempt) or stop, based
 * on EmailSendResult.retryable.
 */
@Processor(EMAIL_QUEUE, { concurrency: 5 })
@Injectable()
export class EmailDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailDeliveryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: EmailProviderFactory,
    private readonly renderer: EmailRendererService,
    private readonly emailConfig: EmailConfigService,
  ) {
    super();
  }

  async process(job: Job<SendEmailJobData>): Promise<void> {
    const { emailLogId } = job.data;

    const log = await this.prisma.emailLog.findUnique({
      where: { id: emailLogId },
    });
    if (!log) {
      this.logger.warn(
        `Discarding email delivery job for missing log ${emailLogId}`,
      );
      return;
    }

    // The email may have been disabled/reconfigured since this job was
    // enqueued — resolve() returns a NullEmailProvider in that case,
    // which fails cleanly below without any network call.
    await this.prisma.emailLog.update({
      where: { id: emailLogId },
      data: { status: EmailLogStatus.SENDING },
    });

    const provider = await this.providerFactory.resolve();
    const attemptsMade = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;

    const rendered = await this.renderer.render(
      log.type,
      (log.metadata as Record<string, unknown> | null) ?? {},
    );

    const result = await provider.send({
      to: log.recipientEmail,
      subject: rendered.subject,
      html: rendered.html,
    });

    if (result.success) {
      await this.prisma.emailLog.update({
        where: { id: emailLogId },
        data: {
          status: EmailLogStatus.SENT,
          provider: provider.kind ?? undefined,
          attemptCount: { increment: 1 },
          sentAt: new Date(),
          lastAttemptAt: new Date(),
          failureReason: null,
        },
      });
      await this.emailConfig.recordSuccessfulSend();
      return;
    }

    const isTerminal = !result.retryable || attemptsMade >= maxAttempts;

    await this.prisma.emailLog.update({
      where: { id: emailLogId },
      data: {
        status: isTerminal ? EmailLogStatus.FAILED : EmailLogStatus.QUEUED,
        provider: provider.kind ?? undefined,
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
        failureReason: result.errorMessage,
      },
    });

    if (isTerminal) {
      await this.emailConfig.recordFailedSend();
      return;
    }

    // Let BullMQ apply its configured backoff and schedule the next
    // attempt — the log row was already left QUEUED (not FAILED) above
    // since this wasn't the terminal attempt.
    throw new Error(result.errorMessage ?? 'Email send failed');
  }
}
