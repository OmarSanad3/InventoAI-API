/**
 * Building the RFC 2822 message a mail API sends.
 *
 * SMTP hid this: nodemailer took an object and produced the wire format. The
 * Gmail API takes the wire format itself, so it has to be written here — and
 * writing message headers by hand has one classic way to go wrong, which is why
 * this is a tested pure function rather than a template string in the adapter.
 *
 * **Header injection is the whole risk.** `subject` is owner-editable text that
 * ends up on a header line, so a subject containing a newline followed by
 * `Bcc: someone@else` would add a recipient nobody chose. Every header value
 * goes through `sanitizeHeaderValue`, which is the one rule in this file that
 * must not be relaxed.
 */

/** Long enough that no body can contain it by accident. */
const BOUNDARY_PREFIX = 'inventoai';

export interface MailAddress {
  readonly name: string | null;
  readonly email: string;
}

export interface MimeMessage {
  readonly from: MailAddress;
  readonly to: MailAddress;
  readonly replyToEmail?: string | null;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** Injectable so a test can assert an exact message; random otherwise. */
  readonly boundary?: string;
}

/**
 * `multipart/alternative` with the plain part first, which is the order the
 * standard defines as least-to-most preferred: a client that renders HTML shows
 * the HTML, and one that does not still shows something a supplier can read.
 */
export function buildMimeMessage({
  from,
  to,
  replyToEmail,
  subject,
  text,
  html,
  boundary = generateBoundary(),
}: MimeMessage): string {
  const headers: string[] = [
    `From: ${formatAddress(from)}`,
    `To: ${formatAddress(to)}`,
  ];

  if (replyToEmail) {
    headers.push(`Reply-To: ${sanitizeHeaderValue(replyToEmail)}`);
  }

  headers.push(
    `Subject: ${encodeHeaderText(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  );

  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBodyBase64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBodyBase64(html),
    `--${boundary}--`,
    '',
  ];

  // CRLF throughout: a bare LF in headers is what makes some servers reject a
  // message outright, and it is not worth discovering that in production.
  return [...headers, '', ...parts].join('\r\n');
}

/** What a mail API wants in its JSON body. */
export function encodeMessageForApi(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

/**
 * `Name <email>`, with the display name quoted or encoded as its characters
 * require. A store called `عبايات ليالي` is the normal case here, not the
 * exotic one, so the non-ASCII path is the one that gets used.
 */
export function formatAddress({ name, email }: MailAddress): string {
  const address = sanitizeHeaderValue(email);
  if (!name?.trim()) {
    return address;
  }

  const display = sanitizeHeaderValue(name.trim());
  return `${isAscii(display) ? quoteIfNeeded(display) : encodeWord(display)} <${address}>`;
}

/**
 * RFC 2047 encoding, applied only when the text needs it — an ASCII subject
 * stays readable in a raw message, which matters when debugging one.
 */
export function encodeHeaderText(value: string): string {
  const clean = sanitizeHeaderValue(value);
  return isAscii(clean) ? clean : encodeWord(clean);
}

/**
 * Strips CR and LF, and nothing else.
 *
 * This is the header-injection guard. It removes the characters that could end
 * a header line and begin another; it deliberately does not "clean up" the
 * value in any other way, because silently rewriting an owner's subject line is
 * its own kind of surprise.
 */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function isAscii(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[^\x00-\x7F]/.test(value);
}

function quoteIfNeeded(display: string): string {
  return /[(),.:;<>@[\]"]/.test(display)
    ? `"${display.replace(/(["\\])/g, '\\$1')}"`
    : display;
}

function encodeWord(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/**
 * Base64 in 76-character lines, which is the limit RFC 2045 sets for an encoded
 * body. Exceeding it is the kind of thing that works everywhere until it
 * doesn't.
 */
function encodeBodyBase64(body: string): string {
  const encoded = Buffer.from(body, 'utf8').toString('base64');
  return (encoded.match(/.{1,76}/g) ?? []).join('\r\n');
}

function generateBoundary(): string {
  const suffix = Math.random().toString(36).slice(2, 12);
  return `${BOUNDARY_PREFIX}_${Date.now().toString(36)}_${suffix}`;
}
