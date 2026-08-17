import { isReplyAlreadyRead, type DedupeState } from './reply-dedupe.util';

describe('isReplyAlreadyRead', () => {
  const buildOffer = (overrides: Partial<DedupeState> = {}): DedupeState => ({
    mailboxMessageId: null,
    repliedAt: null,
    ...overrides,
  });

  it('never skips a paste, which carries no message id', () => {
    const inputOffer = buildOffer({
      mailboxMessageId: 'msg-1',
      repliedAt: new Date('2026-08-17T10:00:00Z'),
    });

    const actual = isReplyAlreadyRead(inputOffer, {
      providerMessageId: null,
      receivedAt: null,
    });

    expect(actual).toBe(false);
  });

  it('skips the same message delivered twice', () => {
    const inputOffer = buildOffer({ mailboxMessageId: 'msg-1' });

    const actual = isReplyAlreadyRead(inputOffer, {
      providerMessageId: 'msg-1',
      receivedAt: new Date('2026-08-17T10:00:00Z'),
    });

    expect(actual).toBe(true);
  });

  it('reads a genuinely new message on an offer that already has one', () => {
    const inputOffer = buildOffer({
      mailboxMessageId: 'msg-1',
      repliedAt: new Date('2026-08-17T10:00:00Z'),
    });

    const actual = isReplyAlreadyRead(inputOffer, {
      providerMessageId: 'msg-2',
      receivedAt: new Date('2026-08-17T11:00:00Z'),
    });

    expect(actual).toBe(false);
  });

  it('skips an older message arriving after a newer one — the expired-watermark re-read', () => {
    const inputOffer = buildOffer({
      mailboxMessageId: 'msg-2',
      repliedAt: new Date('2026-08-17T11:00:00Z'),
    });

    const actual = isReplyAlreadyRead(inputOffer, {
      providerMessageId: 'msg-1',
      receivedAt: new Date('2026-08-17T10:00:00Z'),
    });

    expect(actual).toBe(true);
  });

  it('skips a message received in the same second as the stored one', () => {
    const sameInstant = new Date('2026-08-17T11:00:00Z');
    const inputOffer = buildOffer({
      mailboxMessageId: 'msg-2',
      repliedAt: sameInstant,
    });

    const actual = isReplyAlreadyRead(inputOffer, {
      providerMessageId: 'msg-3',
      receivedAt: sameInstant,
    });

    expect(actual).toBe(true);
  });

  it('reads a first inbound message on an offer nobody has replied to', () => {
    const actual = isReplyAlreadyRead(buildOffer(), {
      providerMessageId: 'msg-1',
      receivedAt: new Date('2026-08-17T10:00:00Z'),
    });

    expect(actual).toBe(false);
  });

  it('reads a message with no timestamp onto an offer that has a reply date', () => {
    const inputOffer = buildOffer({
      mailboxMessageId: 'msg-1',
      repliedAt: new Date('2026-08-17T10:00:00Z'),
    });

    const actual = isReplyAlreadyRead(inputOffer, {
      providerMessageId: 'msg-2',
      receivedAt: null,
    });

    expect(actual).toBe(false);
  });

  it('protects a manual correction from a replayed original quote', () => {
    // The owner typed the numbers at 12:00 after the parse failed. The sync's
    // watermark then expired, so the supplier's 10:00 email is offered again.
    const inputOffer = buildOffer({
      mailboxMessageId: 'msg-1',
      repliedAt: new Date('2026-08-17T12:00:00Z'),
    });

    const actual = isReplyAlreadyRead(inputOffer, {
      providerMessageId: 'msg-1',
      receivedAt: new Date('2026-08-17T10:00:00Z'),
    });

    expect(actual).toBe(true);
  });
});
