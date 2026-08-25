export interface TestEmailTemplateVars {
  provider: string;
  sentAt: string;
}

export function buildTestEmail(vars: TestEmailTemplateVars): {
  subject: string;
  bodyHtml: string;
} {
  const bodyHtml = `
    <p>This is a test email from LinkIQ.</p>
    <p style="color:#6b7280;font-size:13px;">Sent via <strong>${vars.provider}</strong> at ${vars.sentAt}.</p>
    <p>If you received this, your email configuration is working correctly.</p>
  `;

  return { subject: 'LinkIQ test email', bodyHtml };
}
