import { button } from '../layout';
import { escapeHtml } from '../template-renderer.service';

export interface WelcomeTemplateVars {
  firstName: string;
  verificationUrl?: string;
  dashboardUrl: string;
}

export function buildWelcomeEmail(vars: WelcomeTemplateVars): {
  subject: string;
  bodyHtml: string;
} {
  const firstName = escapeHtml(vars.firstName);
  const subject = `Welcome to LinkIQ, ${vars.firstName}!`;

  const verificationBlock = vars.verificationUrl
    ? `<p>First, please confirm your email address:</p>${button(vars.verificationUrl, 'Verify email address')}`
    : '';

  const bodyHtml = `
    <p>Hi ${firstName},</p>
    <p>Welcome to LinkIQ — your account is ready.</p>
    ${verificationBlock}
    <p>Here's how to get started:</p>
    <ul style="padding-left:20px;">
      <li>Create your first short link</li>
      <li>Generate a QR code for it</li>
      <li>Watch clicks roll in on your analytics dashboard</li>
    </ul>
    ${button(vars.dashboardUrl, 'Go to dashboard')}
  `;

  return { subject, bodyHtml };
}
