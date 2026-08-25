import { Injectable, Logger } from '@nestjs/common';
import { EmailLogStatus, type EmailLogType, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { EmailConfigService, isEmailTypeEnabled } from './email-config.service';
import { EmailDeliveryProducer } from './queue/email-delivery.producer';

export interface QueueEmailInput {
  to: string;
  type: EmailLogType;
  recipientUserId?: string;
  templateVars: Record<string, unknown>;
  referenceId?: string;
}

/**
 * The single entry point every other module calls to send an email —
 * mirrors WebhookEventsService.emit's "write the row, then enqueue
 * {id}" shape. Never throws: a Prisma error or a disabled email service
 * both resolve without disrupting the caller, so registration/password
 * reset/report dispatch complete regardless of the state of the email
 * subsystem (§5/§7 of the Sprint 20 spec).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailConfig: EmailConfigService,
    private readonly producer: EmailDeliveryProducer,
  ) {}

  /** Returns the created EmailLog's id (or null on SKIPPED/error) so a
   * caller that needs to link back to it — e.g. ReportDispatchService's
   * EmailReportRun.emailLogId — can, without this method ever needing to
   * throw to communicate failure. */
  async queueEmail(input: QueueEmailInput): Promise<string | null> {
    try {
      const config = await this.emailConfig.get();

      if (!config.enabled) {
        const log = await this.prisma.emailLog.create({
          data: {
            recipientEmail: input.to,
            recipientUserId: input.recipientUserId,
            type: input.type,
            status: EmailLogStatus.SKIPPED,
            failureReason: 'Email service is disabled by an administrator',
            metadata: input.templateVars as Prisma.InputJsonValue,
            referenceId: input.referenceId,
          },
        });
        return log.id;
      }

      if (!isEmailTypeEnabled(config, input.type)) {
        const log = await this.prisma.emailLog.create({
          data: {
            recipientEmail: input.to,
            recipientUserId: input.recipientUserId,
            type: input.type,
            status: EmailLogStatus.SKIPPED,
            failureReason: `${input.type} emails are disabled by an administrator`,
            metadata: input.templateVars as Prisma.InputJsonValue,
            referenceId: input.referenceId,
          },
        });
        return log.id;
      }

      const log = await this.prisma.emailLog.create({
        data: {
          recipientEmail: input.to,
          recipientUserId: input.recipientUserId,
          type: input.type,
          status: EmailLogStatus.QUEUED,
          metadata: input.templateVars as Prisma.InputJsonValue,
          referenceId: input.referenceId,
        },
      });

      this.producer.enqueue({ emailLogId: log.id });
      return log.id;
    } catch (error) {
      this.logger.warn(
        `Failed to queue ${input.type} email for ${input.to}: ${String(error)}`,
      );
      return null;
    }
  }
}
