import { button } from '../layout';

export interface PasswordResetTemplateVars {
  resetUrl: string;
  expiresInMinutes: number;
}

export function buildPasswordResetEmail(vars: PasswordResetTemplateVars): {
  subject: string;
  bodyHtml: string;
} {
  const bodyHtml = `
    <p>We received a request to reset your LinkIQ password.</p>
    ${button(vars.resetUrl, 'Reset password')}
    <p style="color:#6b7280;font-size:13px;">This link expires in ${vars.expiresInMinutes} minutes. If you didn't request this, you can safely ignore this email — your password won't be changed.</p>
  `;

  return { subject: 'Reset your LinkIQ password', bodyHtml };
}
