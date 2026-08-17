import type { MailBrand, RenderedEmail } from './otp-email.template';

/** Won or lost. One template, because the two mails differ by three sentences. */
export type SupplierDecision = 'confirmed' | 'declined';

export interface SupplierDecisionEmailContent {
  readonly brand: MailBrand;
  readonly supplierName: string;
  readonly outcome: SupplierDecision;
  /** "Linen Summer Abaya (Size: M, Colour: Navy)". */
  readonly itemLabel: string;
  /**
   * The agreed terms, already formatted — "Unit price: 249.00 EGP". Empty for a
   * decline: a supplier who lost is told nothing about the offer that won.
   */
  readonly terms: readonly string[];
  readonly replyToEmail: string;
}

const LOGO_SIZE_PX = 56;

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
 * Both halves of closing a deal: the confirmation to the supplier who won, and
 * the decline to everyone else.
 *
 * The decline gives **no reason and no comparison** — not the winning price, not
 * how many others were asked. A supplier who lost this month is a supplier the
 * store wants a quote from next month, and "we went 12% cheaper elsewhere" is
 * the sentence that ends that.
 */
export function buildSupplierDecisionEmail({
  brand,
  supplierName,
  outcome,
  itemLabel,
  terms,
  replyToEmail,
}: SupplierDecisionEmailContent): RenderedEmail {
  const { intro, closing } = buildContent(outcome, itemLabel, brand.name);
  const termLines = outcome === 'confirmed' ? terms : [];

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
          <td style="font-size:14px;line-height:22px;color:#374151;">${escapeHtml(intro)}</td>
        </tr>
        ${termLines.length === 0 ? '' : renderTerms(termLines)}
        <tr>
          <td style="font-size:14px;line-height:22px;color:#374151;padding-top:16px;">${escapeHtml(closing)}</td>
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
    intro,
    ...(termLines.length === 0 ? [] : ['', ...termLines.map((t) => `- ${t}`)]),
    '',
    closing,
    '',
    `Please reply to this email — it reaches ${brand.name} directly at ${replyToEmail}.`,
  ].join('\n');

  return { html, text };
}

function renderTerms(terms: readonly string[]): string {
  return `<tr>
          <td style="padding-top:16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:8px;padding:16px;">
              ${terms
                .map(
                  (term) =>
                    `<tr><td style="font-size:14px;line-height:22px;color:#111827;">${escapeHtml(term)}</td></tr>`,
                )
                .join('\n              ')}
            </table>
          </td>
        </tr>`;
}

function buildContent(
  outcome: SupplierDecision,
  itemLabel: string,
  storeName: string,
): { intro: string; closing: string } {
  if (outcome === 'confirmed') {
    return {
      intro: `Thank you for your offer for ${itemLabel}. We would like to go ahead on the terms below.`,
      closing: `Please confirm the order and let us know the delivery arrangements. We look forward to working with you.\n\nThank you,\n${storeName}`,
    };
  }

  return {
    intro: `Thank you for taking the time to quote for ${itemLabel}.`,
    closing: `On this occasion we have decided to go another way, but we appreciate your response and hope to work with you on the next order.\n\nThank you,\n${storeName}`,
  };
}
