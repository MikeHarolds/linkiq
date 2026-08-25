import { Injectable } from '@nestjs/common';
import { EmailLogStatus, EmailLogType, type Prisma } from '@prisma/client';

import type { RequestContext } from '../../../common/decorators/request-context.decorator';
import {
  paginationMeta,
  type PaginatedResult,
} from '../../../common/dto/pagination.dto';
import type { UpdateEmailConfigDto } from '../../email/dto/update-email-config.dto';
import {
  EmailConfigService,
  type EmailConfigSnapshot,
} from '../../email/email-config.service';
import { EmailService } from '../../email/email.service';
import { EmailProviderFactory } from '../../email/providers/email-provider.factory';
import { PrismaService } from '../../prisma/prisma.service';
import type { DateRangeDto } from '../dto/date-range.dto';
import { resolveDateRange } from '../dto/date-range.dto';
import type { QueryEmailLogsDto } from '../dto/query-email-logs.dto';

export interface EmailStatsSnapshot {
  sent: number;
  failed: number;
  queued: number;
  skipped: number;
  successRate: number | null;
}

/** Admin log-listing shape — deliberately excludes `EmailLog.metadata`.
 * That column stores raw template variables, which for VERIFICATION/
 * PASSWORD_RESET emails includes the single-use token embedded in
 * `verificationUrl`/`resetUrl` — exposing it here would let an admin (or
 * anyone who compromises the admin panel) read and use a live token
 * before its real recipient does. The spec's own required log fields
 * (Recipient/Type/Provider/Status/CreatedAt/SentAt/FailureReason) never
 * include it either — see §13. */
const EMAIL_LOG_LIST_SELECT = {
  id: true,
  recipientEmail: true,
  recipientUserId: true,
  type: true,
  provider: true,
  status: true,
  attemptCount: true,
  lastAttemptAt: true,
  sentAt: true,
  failureReason: true,
  referenceId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EmailLogSelect;

export type EmailLogListItem = Prisma.EmailLogGetPayload<{
  select: typeof EMAIL_LOG_LIST_SELECT;
}>;

/**
 * Admin visibility/control over the transactional email subsystem
 * (§13/§14 of the Sprint 20 spec) — deliberately thin: configuration
 * reads/writes go through EmailConfigService, sends go through
 * EmailService/EmailProviderFactory, this service only adds the
 * admin-scoped listing/aggregation on top, the same "reuse the existing
 * service, don't reimplement" shape AdminWebhooksService already
 * establishes for webhook deliveries. Never overbuilds into an email
 * marketing platform — sent/failed/queued/skipped counts and a success
 * rate is the full stats surface, per the spec's own explicit warning.
 */
@Injectable()
export class AdminEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailConfig: EmailConfigService,
    private readonly emailService: EmailService,
    private readonly providerFactory: EmailProviderFactory,
  ) {}

  getConfig(): Promise<EmailConfigSnapshot> {
    return this.emailConfig.getMasked();
  }

  updateConfig(
    dto: UpdateEmailConfigDto,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<EmailConfigSnapshot> {
    return this.emailConfig.update(dto, adminUserId, ctx);
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const provider = await this.providerFactory.resolve();
    const result = await provider.testConnection();
    await this.emailConfig.recordConnectionTestResult(
      result.ok,
      result.message,
    );
    return result;
  }

  async sendTestEmail(to: string): Promise<void> {
    await this.emailService.queueEmail({
      to,
      type: EmailLogType.TEST,
      templateVars: {
        provider: (await this.emailConfig.get()).provider,
        sentAt: new Date().toISOString(),
      },
    });
  }

  async listLogs(
    query: QueryEmailLogsDto,
  ): Promise<PaginatedResult<EmailLogListItem>> {
    const where: Prisma.EmailLogWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.recipientEmail
        ? {
            recipientEmail: {
              contains: query.recipientEmail,
              mode: 'insensitive',
            },
          }
        : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.emailLog.findMany({
        where,
        select: EMAIL_LOG_LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.emailLog.count({ where }),
    ]);

    return {
      items,
      pagination: paginationMeta(query.page, query.pageSize, totalItems),
    };
  }

  async getStats(query: DateRangeDto): Promise<EmailStatsSnapshot> {
    const { from, to } = resolveDateRange(query.range);

    const statusGroups = await this.prisma.emailLog.groupBy({
      by: ['status'],
      where: { createdAt: { gte: from, lte: to } },
      _count: { _all: true },
    });

    const counts = {
      QUEUED: 0,
      SENDING: 0,
      SENT: 0,
      FAILED: 0,
      SKIPPED: 0,
    } satisfies Record<EmailLogStatus, number>;
    for (const row of statusGroups) {
      counts[row.status] = row._count._all;
    }

    const terminal = counts.SENT + counts.FAILED;
    const successRate = terminal === 0 ? null : counts.SENT / terminal;

    return {
      sent: counts.SENT,
      failed: counts.FAILED,
      queued: counts.QUEUED + counts.SENDING,
      skipped: counts.SKIPPED,
      successRate,
    };
  }
}
