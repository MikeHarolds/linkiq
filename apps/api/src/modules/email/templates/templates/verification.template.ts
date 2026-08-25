import { button } from '../layout';
import { escapeHtml } from '../template-renderer.service';

export interface VerificationTemplateVars {
  firstName: string;
  verificationUrl: string;
  expiresInHours: number;
}

export function buildVerificationEmail(vars: VerificationTemplateVars): {
  subject: string;
  bodyHtml: string;
} {
  const bodyHtml = `
    <p>Hi ${escapeHtml(vars.firstName)},</p>
    <p>Please confirm your email address to finish setting up your LinkIQ account.</p>
    ${button(vars.verificationUrl, 'Verify email address')}
    <p style="color:#6b7280;font-size:13px;">This link expires in ${vars.expiresInHours} hours. If you didn't create a LinkIQ account, you can safely ignore this email.</p>
  `;

  return { subject: 'Verify your email address', bodyHtml };
}
