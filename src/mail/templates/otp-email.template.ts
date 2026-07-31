/**
 * The sender an OTP email is presented as: InventoAI itself for platform
 * accounts, or the store the recipient signed up to.
 */
export interface MailBrand {
  readonly name: string;
  readonly logoUrl: string | null;
}

export interface OtpEmailContent {
  readonly brand: MailBrand;
  readonly intro: string;
  readonly otp: string;
  readonly expiresInMinutes: number;
}

export interface RenderedEmail {
  readonly html: string;
  readonly text: string;
}

const LOGO_SIZE_PX = 56;

/** Escapes the values interpolated into the markup — a store name is user input. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders the brand header. Falls back to a text heading when the store has no
 * logo yet, so a draft store never mails a broken image.
 */
function renderHeader(brand: MailBrand): string {
  const name = escapeHtml(brand.name);
  if (!brand.logoUrl) {
    return `<h1 style="margin:0;font-size:22px;font-weight:700;color:#111827;">${name}</h1>`;
  }
  return `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" width="${LOGO_SIZE_PX}" height="${LOGO_SIZE_PX}" style="display:block;margin:0 auto 12px;border:0;border-radius:8px;" />
          <div style="font-size:18px;font-weight:700;color:#111827;">${name}</div>`;
}

/**
 * Builds the OTP email. Styles are inline and the layout is table-based because
 * Gmail and Outlook drop `<style>` blocks; the code stays selectable text and is
 * repeated in the plain-text part, which is all a client with images blocked
 * will show.
 */
export function buildOtpEmail({
  brand,
  intro,
  otp,
  expiresInMinutes,
}: OtpEmailContent): RenderedEmail {
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;padding:32px;font-family:Arial,Helvetica,sans-serif;">
        <tr>
          <td align="center" style="padding-bottom:24px;">${renderHeader(brand)}</td>
        </tr>
        <tr>
          <td style="font-size:15px;line-height:22px;color:#374151;padding-bottom:20px;">${escapeHtml(intro)}</td>
        </tr>
        <tr>
          <td align="center" style="padding-bottom:20px;">
            <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;background-color:#f3f4f6;border-radius:8px;padding:16px 24px;">${escapeHtml(otp)}</div>
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;line-height:20px;color:#6b7280;">
            This code expires in ${expiresInMinutes} minute(s). If you didn't request it, you can safely ignore this email.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

  const text = `${brand.name}\n\n${intro}\n\nYour verification code is: ${otp}\n\nThis code expires in ${expiresInMinutes} minute(s). If you didn't request it, you can safely ignore this email.`;

  return { html, text };
}
