import { Injectable } from '@nestjs/common';
import type { ReportDay, ReportFrequency, UserReportPreference } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import type { UpdateReportPreferenceDto } from './dto/update-report-preference.dto';

/**
 * A user's analytics-report-email preferences (§10 of the Sprint 20
 * spec) — one row per user, created lazily on first read/write, the
 * same lazy-upsert pattern BrandingService uses for its platform-wide
 * singleton but scoped per-user here instead. No timezone field/logic
 * anywhere in this service — reports run on a fixed UTC schedule (see
 * ReportDispatchService and docs/architecture/email.md).
 */
@Injectable()
export class ReportPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<UserReportPreference> {
    return this.prisma.userReportPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async update(
    userId: string,
    dto: UpdateReportPreferenceDto,
  ): Promise<UserReportPreference> {
    const data: {
      emailReportsEnabled?: boolean;
      frequency?: ReportFrequency;
      reportDay?: ReportDay;
      reportHourUtc?: number;
    } = {};
    if (dto.emailReportsEnabled !== undefined) data.emailReportsEnabled = dto.emailReportsEnabled;
    if (dto.frequency !== undefined) data.frequency = dto.frequency;
    if (dto.reportDay !== undefined) data.reportDay = dto.reportDay;
    if (dto.reportHourUtc !== undefined) data.reportHourUtc = dto.reportHourUtc;

    return this.prisma.userReportPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }
}
