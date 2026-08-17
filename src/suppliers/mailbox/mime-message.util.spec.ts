import {
  buildMimeMessage,
  encodeHeaderText,
  encodeMessageForApi,
  formatAddress,
  sanitizeHeaderValue,
} from './mime-message.util';

describe('sanitizeHeaderValue', () => {
  it('leaves an ordinary value alone', () => {
    expect(sanitizeHeaderValue('Quote request: Linen Abaya')).toBe(
      'Quote request: Linen Abaya',
    );
  });

  it('strips a newline, which is the header-injection guard', () => {
    // Without this, an owner-editable subject could add a recipient.
    const actual = sanitizeHeaderValue(
      'Quote request\nBcc: attacker@evil.test',
    );

    expect(actual).toBe('Quote request Bcc: attacker@evil.test');
    expect(actual).not.toContain('\n');
  });

  it('strips a CRLF pair', () => {
    expect(sanitizeHeaderValue('Subject\r\nBcc: x@y.test')).not.toContain('\r');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeHeaderValue('  padded  ')).toBe('padded');
  });
});

describe('formatAddress', () => {
  it('renders a bare address when there is no display name', () => {
    expect(formatAddress({ name: null, email: 'ops@layali.test' })).toBe(
      'ops@layali.test',
    );
  });

  it('renders an ASCII display name unencoded, so a raw message stays readable', () => {
    expect(
      formatAddress({ name: 'Layali Abayas', email: 'ops@layali.test' }),
    ).toBe('Layali Abayas <ops@layali.test>');
  });

  it('encodes an Arabic store name — the normal case in this market', () => {
    const actual = formatAddress({
      name: 'عبايات ليالي',
      email: 'ops@layali.test',
    });

    expect(actual).toBe(
      `=?UTF-8?B?${Buffer.from('عبايات ليالي', 'utf8').toString('base64')}?= <ops@layali.test>`,
    );
  });

  it('quotes a display name containing a comma', () => {
    expect(
      formatAddress({ name: 'Layali, Abayas', email: 'ops@layali.test' }),
    ).toBe('"Layali, Abayas" <ops@layali.test>');
  });

  it('strips a newline out of a display name', () => {
    const actual = formatAddress({
      name: 'Layali\nBcc: x@y.test',
      email: 'ops@layali.test',
    });

    expect(actual).not.toContain('\n');
  });

  it('treats a whitespace-only name as no name at all', () => {
    expect(formatAddress({ name: '   ', email: 'ops@layali.test' })).toBe(
      'ops@layali.test',
    );
  });
});

describe('encodeHeaderText', () => {
  it('leaves ASCII alone', () => {
    expect(encodeHeaderText('Quote request')).toBe('Quote request');
  });

  it('RFC 2047-encodes an Arabic subject', () => {
    expect(encodeHeaderText('طلب عرض سعر')).toBe(
      `=?UTF-8?B?${Buffer.from('طلب عرض سعر', 'utf8').toString('base64')}?=`,
    );
  });
});

describe('buildMimeMessage', () => {
  const inputMessage = {
    from: { name: 'Layali Abayas', email: 'owner@layali.test' },
    to: { name: 'Nile Textiles', email: 'sales@nile.test' },
    replyToEmail: null,
    subject: 'Quote request: Linen Summer Abaya',
    text: 'Could you quote 18 units?',
    html: '<p>Could you quote 18 units?</p>',
    boundary: 'BOUNDARY',
  };

  it('writes the headers a mail API needs', () => {
    const actual = buildMimeMessage(inputMessage);

    expect(actual).toContain('From: Layali Abayas <owner@layali.test>');
    expect(actual).toContain('To: Nile Textiles <sales@nile.test>');
    expect(actual).toContain('Subject: Quote request: Linen Summer Abaya');
    expect(actual).toContain('MIME-Version: 1.0');
    expect(actual).toContain(
      'Content-Type: multipart/alternative; boundary="BOUNDARY"',
    );
  });

  it('omits Reply-To when there is none — the mailbox path relies on that', () => {
    // A Reply-To pointing at some other address of the owner's would route the
    // reply somewhere the sync cannot see it.
    expect(buildMimeMessage(inputMessage)).not.toContain('Reply-To:');
  });

  it('includes Reply-To when one is given', () => {
    const actual = buildMimeMessage({
      ...inputMessage,
      replyToEmail: 'owner@layali.test',
    });

    expect(actual).toContain('Reply-To: owner@layali.test');
  });

  it('carries both alternatives, plain first', () => {
    const actual = buildMimeMessage(inputMessage);
    const plainAt = actual.indexOf('Content-Type: text/plain');
    const htmlAt = actual.indexOf('Content-Type: text/html');

    expect(plainAt).toBeGreaterThan(-1);
    expect(htmlAt).toBeGreaterThan(plainAt);
  });

  it('base64-encodes both bodies and closes the multipart', () => {
    const actual = buildMimeMessage(inputMessage);

    expect(actual).toContain(
      Buffer.from(inputMessage.text, 'utf8').toString('base64'),
    );
    expect(actual).toContain(
      Buffer.from(inputMessage.html, 'utf8').toString('base64'),
    );
    expect(actual.trimEnd().endsWith('--BOUNDARY--')).toBe(true);
  });

  it('uses CRLF line endings throughout', () => {
    const actual = buildMimeMessage(inputMessage);

    expect(actual).toContain('\r\n');
    expect(/[^\r]\n/.test(actual)).toBe(false);
  });

  it('separates headers from the body with a blank line', () => {
    const actual = buildMimeMessage(inputMessage);

    expect(actual).toContain(
      'Content-Type: multipart/alternative; boundary="BOUNDARY"\r\n\r\n--BOUNDARY',
    );
  });

  it('keeps an injected header out of the header block', () => {
    const actual = buildMimeMessage({
      ...inputMessage,
      subject: 'Quote\r\nBcc: attacker@evil.test',
    });

    expect(actual).not.toContain('\r\nBcc:');
  });

  it('wraps a long base64 body at 76 characters, as RFC 2045 requires', () => {
    const actual = buildMimeMessage({
      ...inputMessage,
      text: 'x'.repeat(500),
    });
    const longest = Math.max(
      ...actual.split('\r\n').map((line) => line.length),
    );

    expect(longest).toBeLessThanOrEqual(76);
  });

  it('generates a unique boundary when none is given', () => {
    const withoutBoundary = { ...inputMessage, boundary: undefined };

    const first = buildMimeMessage(withoutBoundary);
    const second = buildMimeMessage(withoutBoundary);

    expect(first).not.toEqual(second);
  });
});

describe('encodeMessageForApi', () => {
  it('encodes base64url, which is what a mail API expects', () => {
    const actual = encodeMessageForApi('From: a@b.test\r\n\r\nhi');

    expect(actual).toBe(
      Buffer.from('From: a@b.test\r\n\r\nhi', 'utf8').toString('base64url'),
    );
    expect(actual).not.toContain('+');
    expect(actual).not.toContain('/');
    expect(actual).not.toContain('=');
  });
});
