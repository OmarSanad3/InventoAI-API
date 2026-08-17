import {
  extractPlainTextBody,
  stripQuotedReply,
  type MailPartLike,
} from './reply-text.util';
import { MAX_REPLY_LENGTH } from '../suppliers.constants';

/** Mail APIs hand bodies over base64url, so a fixture has to be encoded too. */
const encode = (text: string): string =>
  Buffer.from(text, 'utf8').toString('base64url');

describe('extractPlainTextBody', () => {
  it('reads a single-part plain-text message', () => {
    const inputPart: MailPartLike = {
      mimeType: 'text/plain',
      body: { data: encode('249 EGP each, 10 days.') },
    };

    expect(extractPlainTextBody(inputPart)).toBe('249 EGP each, 10 days.');
  });

  it('prefers the plain part of a multipart/alternative', () => {
    const inputPart: MailPartLike = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: encode('plain wins') } },
        { mimeType: 'text/html', body: { data: encode('<p>html loses</p>') } },
      ],
    };

    expect(extractPlainTextBody(inputPart)).toBe('plain wins');
  });

  it('finds the text nested inside a multipart/mixed, which is what an attachment does', () => {
    const inputPart: MailPartLike = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            {
              mimeType: 'text/plain',
              body: { data: encode('quote attached, 235 EGP') },
            },
          ],
        },
        { mimeType: 'application/pdf', body: { data: encode('%PDF') } },
      ],
    };

    expect(extractPlainTextBody(inputPart)).toBe('quote attached, 235 EGP');
  });

  it('falls back to the HTML part, converted to text', () => {
    const inputPart: MailPartLike = {
      mimeType: 'text/html',
      body: {
        data: encode('<p>235 EGP each</p><p>Delivery in 14&nbsp;days</p>'),
      },
    };

    expect(extractPlainTextBody(inputPart)).toBe(
      '235 EGP each\nDelivery in 14 days',
    );
  });

  it('drops script and style content from an HTML-only message', () => {
    const inputPart: MailPartLike = {
      mimeType: 'text/html',
      body: {
        data: encode(
          '<style>p{color:red}</style><p>Price: 100</p><script>alert(1)</script>',
        ),
      },
    };

    expect(extractPlainTextBody(inputPart)).toBe('Price: 100');
  });

  it('returns an empty string for a part with no text at all', () => {
    expect(extractPlainTextBody({ mimeType: 'application/pdf' })).toBe('');
  });

  it('returns an empty string for a missing payload', () => {
    expect(extractPlainTextBody(undefined)).toBe('');
  });
});

describe('stripQuotedReply', () => {
  it('keeps the reply and drops the quoted original', () => {
    // The trap this whole helper exists for: our own request is quoted below,
    // and it names the quantity *we* asked for.
    const inputBody = [
      'We can do 235 EGP each, delivery in two weeks.',
      '',
      'On Mon, 17 Aug 2026 at 14:02, Layali Abayas <ops@layali.test> wrote:',
      '> We would like to order 18 units of the Linen Summer Abaya.',
      '> Could you confirm your unit price and delivery time?',
    ].join('\n');

    const actual = stripQuotedReply(inputBody);

    expect(actual).toBe('We can do 235 EGP each, delivery in two weeks.');
    expect(actual).not.toContain('18 units');
  });

  it('drops an Outlook-style quoted original', () => {
    const inputBody = [
      'Price is 300 EGP per piece.',
      '',
      '-----Original Message-----',
      'From: Layali Abayas',
      'We would like 40 units.',
    ].join('\n');

    expect(stripQuotedReply(inputBody)).toBe('Price is 300 EGP per piece.');
  });

  it('drops an Arabic quote header, which Gmail localises', () => {
    const inputBody = [
      'السعر 235 جنيه للقطعة.',
      '',
      'في 17 أغسطس 2026، كتب:',
      '> نرغب في شراء 18 قطعة.',
    ].join('\n');

    const actual = stripQuotedReply(inputBody);

    expect(actual).toBe('السعر 235 جنيه للقطعة.');
    expect(actual).not.toContain('18');
  });

  it('drops a bare Outlook divider line', () => {
    const inputBody = [
      '250 EGP, ten days.',
      '',
      '________________________________',
      'From: Layali',
      'We would like 18 units.',
    ].join('\n');

    expect(stripQuotedReply(inputBody)).toBe('250 EGP, ten days.');
  });

  it('keeps the reply when the sender wrote *below* the quote', () => {
    // Bottom-posting. Cutting at the marker would leave nothing, so the cut is
    // abandoned and the unquoted lines are used instead.
    const inputBody = [
      'On Mon, 17 Aug 2026 at 14:02, Layali Abayas <ops@layali.test> wrote:',
      '> We would like to order 18 units.',
      '> Please confirm your price.',
      '',
      'Yes — 235 EGP each, two weeks.',
    ].join('\n');

    const actual = stripQuotedReply(inputBody);

    expect(actual).toBe('Yes — 235 EGP each, two weeks.');
    expect(actual).not.toContain('18 units');
  });

  it('leaves a reply with no quote untouched', () => {
    expect(stripQuotedReply('235 EGP each, 14 days, 15 in stock.')).toBe(
      '235 EGP each, 14 days, 15 in stock.',
    );
  });

  it('keeps a sentence containing the word "wrote" mid-line', () => {
    const inputBody = 'I wrote to our factory and they confirmed 235 EGP.';

    expect(stripQuotedReply(inputBody)).toBe(inputBody);
  });

  it('normalises CRLF line endings, which is what arrives over the wire', () => {
    expect(stripQuotedReply('235 EGP each.\r\n\r\nThanks.')).toBe(
      '235 EGP each.\n\nThanks.',
    );
  });

  it('collapses a mail client’s runs of blank lines', () => {
    expect(stripQuotedReply('235 EGP.\n\n\n\n\nThanks.')).toBe(
      '235 EGP.\n\nThanks.',
    );
  });

  it('caps the result at the same bound the paste route validates', () => {
    const actual = stripQuotedReply('x'.repeat(MAX_REPLY_LENGTH + 500));

    expect(actual).toHaveLength(MAX_REPLY_LENGTH);
  });

  it('returns an empty string for an empty body', () => {
    expect(stripQuotedReply('')).toBe('');
  });

  it('falls back to the raw text when every line looks quoted', () => {
    // Nothing survives either pass, and returning nothing would silently drop a
    // reply. The extractor gets something to read and may still fail honestly.
    const inputBody = '> 235 EGP each\n> two weeks';

    expect(stripQuotedReply(inputBody)).toBe(inputBody);
  });
});
