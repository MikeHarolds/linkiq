import { Injectable, Logger } from '@nestjs/common';
import { EmailLogType, Prisma, ReportDay, type ReportFrequency } from '@prisma/client';

import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

import { ReportGenerationService } from './report-generation.service';
import { computeDailyPeriod, computeWeeklyPeriod, type ReportPeriod } from './utils/report-period';

/** JS Date#getUTCDay() is 0=Sunday..6=Saturday; ReportDay is 1=Monday
 * ISO-style (see the enum's own doc comment in schema.prisma). */
const REPORT_DAY_BY_JS_DAY: ReportDay[] = [
  ReportDay.SUNDAY,
  ReportDay.MONDAY,
  ReportDay.TUESDAY,
  ReportDay.WEDNESDAY,
  ReportDay.THURSDAY,
  ReportDay.FRIDAY,
  ReportDay.SATURDAY,
];

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

/**
 * The hourly tick handler (§12 of the Sprint 20 spec) — invoked by
 * ReportDispatchProcessor for both the daily and weekly BullMQ
 * repeatable schedulers. Idempotency is enforced by
 * EmailReportRun's own unique constraint (userId, frequency,
 * periodStart): the `create()` call below succeeding IS the dedup gate,
 * not any in-memory or application-level "have I seen this" check — so
 * a restart, a double-fire, or a manual re-run of the same tick can
 * never send the same user the same report twice.
 */
@Injectable()
export class ReportDispatchService {
  private readonly logger = new Logger(ReportDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly generation: ReportGenerationService,
    private readonly emailService: EmailService,
  ) {}

  async runTick(frequency: ReportFrequency): Promise<void> {
    const now = new Date();
    const nowUtcHour = now.getUTCHours();
    const nowUtcDay = REPORT_DAY_BY_JS_DAY[now.getUTCDay()];
    const period = frequency === 'DAILY' ? computeDailyPeriod(now) : computeWeeklyPeriod(now);

    const eligible = await this.prisma.userReportPreference.findMany({
      where: {
        emailReportsEnabled: true,
        frequency,
        reportHourUtc: nowUtcHour,
        ...(frequency === 'WEEKLY' ? { reportDay: nowUtcDay } : {}),
      },
      select: { userId: true },
    });

    for (const { userId } of eligible) {
      // Isolated per user — one workspace/analytics failure must never
      // abort the rest of the batch (email failures must never break
      // core app functionality, and a report run is no exception).
      try {
        await this.dispatchForUser(userId, frequency, period);
      } catch (error) {
        this.logger.warn(
          `Failed to dispatch ${frequency} report for user ${userId}: ${String(error)}`,
        );
      }
    }
  }

  private async dispatchForUser(
    userId: string,
    frequency: ReportFrequency,
    period: ReportPeriod,
  ): Promise<void> {
    let run;
    try {
      run = await this.prisma.emailReportRun.create({
        data: {
          userId,
          frequency,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        // Already dispatched for this exact (user, frequency, period) —
        // this is the expected, harmless outcome of a duplicate tick.
        return;
      }
      throw error;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true, isActive: true },
    });
    if (!user || !user.isActive) {
      return;
    }

    const workspaceId = await this.resolveWorkspaceIdForUser(userId);
    if (!workspaceId) {
      return;
    }

    const data = await this.generation.buildReportData(workspaceId, period);

    const emailLogId = await this.emailService.queueEmail({
      to: user.email,
      type: frequency === 'DAILY' ? EmailLogType.DAILY_REPORT : EmailLogType.WEEKLY_REPORT,
      recipientUserId: userId,
      templateVars: { firstName: user.firstName, ...data },
      referenceId: run.id,
    });

    if (emailLogId) {
      await this.prisma.emailReportRun.update({
        where: { id: run.id },
        data: { emailLogId },
      });
    }
  }

  /** v1 simplification (documented, not hidden — see
   * docs/architecture/email.md): a user can belong to multiple
   * workspaces, but UserReportPreference is per-user, not per-workspace.
   * Reports are generated for the workspace the user OWNS, falling back
   * to their first membership if they own none. */
  private async resolveWorkspaceIdForUser(userId: string): Promise<string | null> {
    const owned = await this.prisma.workspaceMember.findFirst({
      where: { userId, role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
      select: { workspaceId: true },
    });
    if (owned) return owned.workspaceId;

    const anyMembership = await this.prisma.workspaceMember.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { workspaceId: true },
    });
    return anyMembership?.workspaceId ?? null;
  }
}
