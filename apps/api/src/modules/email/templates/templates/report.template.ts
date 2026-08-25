import { button } from '../layout';

export interface ReportTemplateVars {
  reportPeriod: string;
  totalClicks: number;
  uniqueVisitors: number;
  activeLinks: number;
  campaignCount: number;
  topSources: Array<{ label: string; clicks: number }>;
  topCountries: Array<{ label: string; clicks: number }>;
  topLinks: Array<{ label: string; clicks: number }>;
  clickTrend: Array<{ label: string; clicks: number }>;
  dashboardUrl: string;
}

function statTile(label: string, value: number): string {
  return `<td style="padding:12px;text-align:center;">
    <div style="font-size:22px;font-weight:700;color:#111827;">${value.toLocaleString()}</div>
    <div style="font-size:12px;color:#6b7280;">${label}</div>
  </td>`;
}

function rowTable(title: string, rows: Array<{ label: string; clicks: number }>): string {
  if (rows.length === 0) {
    return `<h3 style="font-size:14px;margin:20px 0 8px;">${title}</h3><p style="color:#9ca3af;font-size:13px;">No data for this period.</p>`;
  }
  const rowsHtml = rows
    .map(
      (r) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;">${r.label}</td><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;text-align:right;">${r.clicks.toLocaleString()}</td></tr>`,
    )
    .join('');
  return `<h3 style="font-size:14px;margin:20px 0 8px;">${title}</h3>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">${rowsHtml}</table>`;
}

/** Table-based horizontal bar chart (no images/canvas — must render in
 * email clients that strip <img>/<svg>/JS). Bar width is a percentage of
 * the period's peak bucket so the chart is legible regardless of scale. */
function trendChart(title: string, points: Array<{ label: string; clicks: number }>): string {
  if (points.length === 0) {
    return `<h3 style="font-size:14px;margin:20px 0 8px;">${title}</h3><p style="color:#9ca3af;font-size:13px;">No data for this period.</p>`;
  }
  const max = Math.max(1, ...points.map((p) => p.clicks));
  const rowsHtml = points
    .map((p) => {
      const widthPct = Math.round((p.clicks / max) * 100);
      return `<tr>
        <td style="padding:3px 8px 3px 0;font-size:11px;color:#6b7280;white-space:nowrap;">${p.label}</td>
        <td style="padding:3px 0;width:100%;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="background-color:#4f46e5;border-radius:3px;width:${widthPct}%;height:10px;line-height:10px;font-size:0;">&nbsp;</td>
            <td style="font-size:11px;color:#111827;padding-left:6px;white-space:nowrap;">${p.clicks.toLocaleString()}</td>
          </tr></table>
        </td>
      </tr>`;
    })
    .join('');
  return `<h3 style="font-size:14px;margin:20px 0 8px;">${title}</h3>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">${rowsHtml}</table>`;
}

/** Shared body used by both daily and weekly reports — the only
 * difference between them is the subject line and which date range the
 * caller (ReportGenerationService) computed the vars from; no separate
 * layout logic is duplicated per frequency. */
export function buildReportEmailBody(vars: ReportTemplateVars): string {
  return `
    <p>Here's your traffic summary for <strong>${vars.reportPeriod}</strong>.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#f9fafb;border-radius:6px;">
      <tr>
        ${statTile('Total clicks', vars.totalClicks)}
        ${statTile('Unique visitors', vars.uniqueVisitors)}
        ${statTile('Active links', vars.activeLinks)}
        ${statTile('Active campaigns', vars.campaignCount)}
      </tr>
    </table>
    ${trendChart('Click trend', vars.clickTrend)}
    ${rowTable('Top sources', vars.topSources)}
    ${rowTable('Top countries', vars.topCountries)}
    ${rowTable('Top links', vars.topLinks)}
    ${button(vars.dashboardUrl, 'View full analytics')}
    <p style="color:#9ca3af;font-size:12px;margin-top:20px;">Reports are sent based on UTC time. Manage your report preferences from Settings → Notifications.</p>
  `;
}

export function buildDailyReportEmail(vars: ReportTemplateVars): {
  subject: string;
  bodyHtml: string;
} {
  return {
    subject: `Your daily LinkIQ report — ${vars.reportPeriod}`,
    bodyHtml: buildReportEmailBody(vars),
  };
}

export function buildWeeklyReportEmail(vars: ReportTemplateVars): {
  subject: string;
  bodyHtml: string;
} {
  return {
    subject: `Your weekly LinkIQ report — ${vars.reportPeriod}`,
    bodyHtml: buildReportEmailBody(vars),
  };
}
