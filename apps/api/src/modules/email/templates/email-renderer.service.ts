import { Injectable } from '@nestjs/common';
import { EmailLogType } from '@prisma/client';

import { BrandingService } from '../../branding/branding.service';

import { wrapInLayout } from './layout';
import { buildPasswordResetEmail, type PasswordResetTemplateVars } from './templates/password-reset.template';
import { buildDailyReportEmail, buildWeeklyReportEmail, type ReportTemplateVars } from './templates/report.template';
import { buildTestEmail, type TestEmailTemplateVars } from './templates/test-email.template';
import { buildVerificationEmail, type VerificationTemplateVars } from './templates/verification.template';
import { buildWelcomeEmail, type WelcomeTemplateVars } from './templates/welcome.template';

export interface RenderedEmail {
  subject: string;
  html: string;
}

/**
 * Maps an EmailLogType + its stored template variables (EmailLog.metadata
 * — see that field's own doc comment) to a fully rendered, branded email.
 * The one place every template file above is dispatched from — the
 * delivery processor calls this on every attempt (so a retried job
 * re-renders rather than reusing anything cached), never the templates
 * directly.
 */
@Injectable()
export class EmailRendererService {
  constructor(private readonly branding: BrandingService) {}

  async render(
    type: EmailLogType,
    vars: Record<string, unknown>,
  ): Promise<RenderedEmail> {
    const brand = await this.branding.get();

    const built = (() => {
      switch (type) {
        case EmailLogType.WELCOME:
          return buildWelcomeEmail(vars as unknown as WelcomeTemplateVars);
        case EmailLogType.VERIFICATION:
          return buildVerificationEmail(vars as unknown as VerificationTemplateVars);
        case EmailLogType.PASSWORD_RESET:
          return buildPasswordResetEmail(vars as unknown as PasswordResetTemplateVars);
        case EmailLogType.DAILY_REPORT:
          return buildDailyReportEmail(vars as unknown as ReportTemplateVars);
        case EmailLogType.WEEKLY_REPORT:
          return buildWeeklyReportEmail(vars as unknown as ReportTemplateVars);
        case EmailLogType.TEST:
          return buildTestEmail(vars as unknown as TestEmailTemplateVars);
      }
    })();

    return {
      subject: built.subject,
      html: wrapInLayout({
        siteName: brand.siteName,
        logoUrl: brand.logoUrl,
        bodyHtml: built.bodyHtml,
      }),
    };
  }
}
