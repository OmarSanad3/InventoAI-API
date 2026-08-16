import type { MailBrand, RenderedEmail } from './otp-email.template';

/** One line of the brief, reduced to what an email shows. */
export interface BriefEmailLine {
  readonly title: string;
  readonly body: string;
  /** Drives the accent stripe: critical is red, warning amber, info grey. */
  readonly severity: 'critical' | 'warning' | 'info';
}

export interface AdvisorBriefEmailContent {
  readonly brand: MailBrand;
  readonly headline: string;
  readonly lines: readonly BriefEmailLine[];
  /** Deep link into the dashboard's Advisor panel. */
  readonly dashboardUrl: string;
}

const LOGO_SIZE_PX = 56;

const SEVERITY_COLOURS: Record<BriefEmailLine['severity'], string> = {
  critical: '#dc2626',
  warning: '#d97706',
  info: '#6b7280',
};

/** Escapes every interpolated value — a product title is user input, and a
 *  shopper's own question reaches this template verbatim. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHeader(brand: MailBrand): string {
  const name = escapeHtml(brand.name);
  if (!brand.logoUrl) {
    return `<h1 style="margin:0;font-size:22px;font-weight:700;color:#111827;">${name}</h1>`;
  }
  return `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" width="${LOGO_SIZE_PX}" height="${LOGO_SIZE_PX}" style="display:block;margin:0 auto 12px;border:0;border-radius:8px;" />
          <div style="font-size:18px;font-weight:700;color:#111827;">${name}</div>`;
}

function renderLine(line: BriefEmailLine): string {
  const colour = SEVERITY_COLOURS[line.severity];
  return `<tr>
          <td style="padding:0 0 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="4" style="background-color:${colour};border-radius:2px;"></td>
                <td style="padding-left:12px;">
                  <div style="font-size:15px;font-weight:700;color:#111827;padding-bottom:4px;">${escapeHtml(line.title)}</div>
                  <div style="font-size:14px;line-height:21px;color:#374151;">${escapeHtml(line.body)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

/**
 * The daily brief as an email — the same branded shell the OTP template
 * established, table-based and inline-styled because Gmail and Outlook drop
 * `<style>` blocks.
 *
 * The plain-text part carries every line too: it is what a client with images
 * blocked shows, and it is the version an owner reads on a watch.
 */
export function buildAdvisorBriefEmail({
  brand,
  headline,
  lines,
  dashboardUrl,
}: AdvisorBriefEmailContent): RenderedEmail {
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;padding:32px;font-family:Arial,Helvetica,sans-serif;">
        <tr>
          <td align="center" style="padding-bottom:24px;">${renderHeader(brand)}</td>
        </tr>
        <tr>
          <td style="font-size:16px;line-height:24px;color:#111827;font-weight:700;padding-bottom:20px;">${escapeHtml(headline)}</td>
        </tr>
        ${lines.map(renderLine).join('\n')}
        <tr>
          <td align="center" style="padding-top:12px;">
            <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background-color:#111827;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;padding:12px 24px;">Open your dashboard</a>
          </td>
        </tr>
        <tr>
          <td style="font-size:12px;line-height:18px;color:#6b7280;padding-top:20px;">
            You're getting this because your daily brief is switched on. You can turn it off in your dashboard settings.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

  const text = [
    brand.name,
    '',
    headline,
    '',
    ...lines.map((line) => `- ${line.title}\n  ${line.body}`),
    '',
    `Open your dashboard: ${dashboardUrl}`,
    '',
    "You're getting this because your daily brief is switched on. You can turn it off in your dashboard settings.",
  ].join('\n');

  return { html, text };
}
