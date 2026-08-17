import type { MailBrand, RenderedEmail } from './otp-email.template';

export interface SupplierRequestEmailContent {
  readonly brand: MailBrand;
  /** The supplier, greeted by name — the body itself greets nobody. */
  readonly supplierName: string;
  /** The owner's own text, plain, exactly as they left it. */
  readonly body: string;
  /** Where a reply should go: the store owner's address. */
  readonly replyToEmail: string;
}

const LOGO_SIZE_PX = 56;

/** Escapes every interpolated value — the body is text an owner typed. */
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

/**
 * The purchase request as an email — the same branded shell the OTP template
 * established, under the **store's** brand rather than the platform's: the
 * supplier is dealing with Layali, not with InventoAI.
 *
 * The body is escaped and rendered inside a `white-space:pre-line` block, so
 * the owner's line breaks survive and their markup — if they typed any — stays
 * characters. It is the same rule the FAQ answer follows, and for the same
 * reason: there is no sanitiser in this project.
 */
export function buildSupplierRequestEmail({
  brand,
  supplierName,
  body,
  replyToEmail,
}: SupplierRequestEmailContent): RenderedEmail {
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;padding:32px;font-family:Arial,Helvetica,sans-serif;">
        <tr>
          <td align="center" style="padding-bottom:24px;">${renderHeader(brand)}</td>
        </tr>
        <tr>
          <td style="font-size:15px;line-height:22px;color:#111827;padding-bottom:12px;">Dear ${escapeHtml(supplierName)},</td>
        </tr>
        <tr>
          <td style="font-size:14px;line-height:22px;color:#374151;white-space:pre-line;">${escapeHtml(body)}</td>
        </tr>
        <tr>
          <td style="font-size:12px;line-height:18px;color:#6b7280;padding-top:24px;">
            Please reply to this email — it reaches ${escapeHtml(brand.name)} directly at ${escapeHtml(replyToEmail)}.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

  const text = [
    `Dear ${supplierName},`,
    '',
    body,
    '',
    `Please reply to this email — it reaches ${brand.name} directly at ${replyToEmail}.`,
  ].join('\n');

  return { html, text };
}
