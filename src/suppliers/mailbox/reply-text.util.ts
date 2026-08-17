import { MAX_REPLY_LENGTH } from '../suppliers.constants';

/**
 * Turning a mail provider's message into the sentences a supplier actually
 * typed — and nothing else.
 *
 * This is the helper that makes automatic ingestion *safe to extract from*, and
 * it is not cosmetic. A reply quotes the request underneath it, and the request
 * is a letter **we** wrote naming the quantity we asked for. Hand the whole
 * thing to the extractor and it reads our own "we would like to order 18 units"
 * back as the supplier's offered quantity — a number nobody quoted, in the one
 * table an owner spends money from. The paste route never had this problem
 * because a human selects the part they mean; a machine has to be told.
 *
 * Everything here is pure and string-shaped so it can be tested without a
 * mailbox, which is the same reason `sanitizeExtractedOffer` is a function.
 */

/** The part of a MIME tree we read. Only what is needed, nothing trusted. */
export interface MailPartLike {
  readonly mimeType?: string;
  readonly body?: { readonly data?: string };
  readonly parts?: readonly MailPartLike[];
}

/**
 * Where a quoted original begins. Matched against a whole trimmed line, so a
 * supplier who writes the word "wrote" mid-sentence keeps their sentence.
 *
 * Arabic is here because Gmail localises this line and the platform's first
 * market is Egypt — an Arabic-language client quoting our request produces
 * `في ... كتب:`, which an English-only pattern walks straight past.
 *
 * The Arabic pattern uses **no `\b`**, deliberately: JavaScript's word boundary
 * is defined over `[A-Za-z0-9_]`, so `\bكتب` can never match — an Arabic letter
 * is not a word character, and there is no boundary to find. The colon is
 * required instead, which is both what Gmail writes and a narrower test than a
 * bare "ends with كتب" would be.
 */
const QUOTE_HEADER_PATTERNS: readonly RegExp[] = [
  /^on\b.*\bwrote:?\s*$/i,
  /كتب\s*:\s*$/,
  /^-{2,}\s*original message\s*-{2,}$/i,
  /^-{2,}\s*forwarded message\s*-{2,}$/i,
  /^_{10,}$/,
  /^from:\s*.+$/i,
  /^sent from my \w+$/i,
];

/** A line the provider itself marked as quoted. */
const QUOTED_LINE = /^\s*>/;

/**
 * The plain text of a message, whatever the sender's client chose to send.
 *
 * `text/plain` is preferred over `text/html` because it is what the sender
 * typed rather than a rendering of it, and because Gmail's own plain part keeps
 * the `>` markers this file depends on.
 */
export function extractPlainTextBody(part: MailPartLike | undefined): string {
  if (!part) {
    return '';
  }

  const plain = findPartByMimeType(part, 'text/plain');
  if (plain) {
    return decodeBase64Url(plain);
  }

  const html = findPartByMimeType(part, 'text/html');
  return html ? convertHtmlToText(decodeBase64Url(html)) : '';
}

/**
 * The reply with the quoted original removed, capped at `MAX_REPLY_LENGTH` so a
 * machine-fed reply is stored under exactly the bound the paste route validates.
 *
 * **It never returns less than the sender wrote.** If cutting at the quote
 * marker leaves nothing — which is what bottom-posting looks like, where the
 * new text sits *below* the quote — the cut is abandoned and the unquoted lines
 * are used instead. Losing the reply to be tidy would be the worse failure.
 */
export function stripQuotedReply(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');

  const markerIndex = lines.findIndex(isQuoteHeader);
  const beforeMarker = markerIndex === -1 ? lines : lines.slice(0, markerIndex);

  const trimmed = dropQuotedLines(beforeMarker);
  if (trimmed) {
    return capLength(trimmed);
  }

  // Nothing above the quote: the sender wrote underneath it. Keep every line
  // the provider did not mark as quoted, wherever it sits.
  const unquoted = dropQuotedLines(
    lines.filter((line) => !isQuoteHeader(line)),
  );
  return capLength(unquoted || raw.trim());
}

/** Collapses runs of blank lines so a mail client's padding is not "content". */
function dropQuotedLines(lines: readonly string[]): string {
  return lines
    .filter((line) => !QUOTED_LINE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isQuoteHeader(line: string): boolean {
  const candidate = line.trim();
  if (!candidate) {
    return false;
  }
  return QUOTE_HEADER_PATTERNS.some((pattern) => pattern.test(candidate));
}

function capLength(text: string): string {
  return text.length > MAX_REPLY_LENGTH
    ? text.slice(0, MAX_REPLY_LENGTH)
    : text;
}

/**
 * Depth-first, because a `multipart/alternative` nested inside a
 * `multipart/mixed` is what an attachment does to a message and the text is
 * still in there somewhere.
 */
function findPartByMimeType(
  part: MailPartLike,
  mimeType: string,
): string | null {
  if (part.mimeType === mimeType && part.body?.data) {
    return part.body.data;
  }

  for (const child of part.parts ?? []) {
    const found = findPartByMimeType(child, mimeType);
    if (found) {
      return found;
    }
  }

  return null;
}

/** Mail providers encode bodies base64url, not base64. */
function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

/**
 * A last resort, for a client that sent no plain part. Not a sanitiser and not
 * trying to be one — the output is read by a model and stored as text, never
 * rendered, which is the same rule the FAQ answers follow.
 */
function convertHtmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<blockquote\b[^>]*>/gi, '\n> ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
