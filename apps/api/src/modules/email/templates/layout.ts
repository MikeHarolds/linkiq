/** Shared header/footer wrapper every template body renders inside —
 * plain table-based HTML email markup (no external CSS/JS: email
 * clients strip both), branded via siteName/logoUrl only (BrandingService
 * has no color token — see that model's own docs — so this picks its
 * own fixed accent color). */
export function wrapInLayout(input: {
  siteName: string;
  logoUrl: string | null;
  bodyHtml: string;
  footerNote?: string;
}): string {
  const { siteName, logoUrl, bodyHtml, footerNote } = input;
  const logo = logoUrl
    ? `<img src="${logoUrl}" alt="${siteName}" height="32" style="height:32px;" />`
    : `<span style="font-size:20px;font-weight:700;color:#4f46e5;">${siteName}</span>`;

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #eee;">${logo}</td>
          </tr>
          <tr>
            <td style="padding:32px;color:#111827;font-size:15px;line-height:1.6;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #eee;color:#9ca3af;font-size:12px;">
              ${footerNote ?? `You're receiving this email from ${siteName}.`}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function button(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
    <tr>
      <td style="background-color:#4f46e5;border-radius:6px;">
        <a href="${url}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">${label}</a>
      </td>
    </tr>
  </table>`;
}
