import { ChatResolution } from '../enums/chat-resolution.enum';
import { ChatTurnSources, createTurnSources } from '../types/chat-turn';
import { resolveOutcome } from './resolve-outcome.util';

const sourcesWith = (overrides: Partial<ChatTurnSources>): ChatTurnSources => ({
  ...createTurnSources(),
  ...overrides,
});

describe('resolveOutcome', () => {
  it('is answered when a tool returned something', () => {
    const actual = resolveOutcome(
      sourcesWith({ callCount: 1, hitCount: 1, productIds: ['p1'] }),
      false,
    );

    expect(actual).toBe(ChatResolution.Answered);
  });

  it('is unanswered when tools ran and found nothing — the Advisor case', () => {
    const actual = resolveOutcome(
      sourcesWith({ callCount: 2, hitCount: 0 }),
      false,
    );

    expect(actual).toBe(ChatResolution.Unanswered);
  });

  it('is off-topic when no tool was reached for at all', () => {
    const actual = resolveOutcome(
      sourcesWith({ callCount: 0, hitCount: 0 }),
      false,
    );

    expect(actual).toBe(ChatResolution.OffTopic);
  });

  it('separates off-topic from unanswered, which is the distinction that matters', () => {
    const offTopic = resolveOutcome(sourcesWith({ callCount: 0 }), false);
    const unanswered = resolveOutcome(sourcesWith({ callCount: 1 }), false);

    expect(offTopic).not.toBe(unanswered);
  });

  it('is needs-login when the sign-in tool ran', () => {
    const actual = resolveOutcome(
      sourcesWith({ callCount: 1, needsSignIn: true }),
      false,
    );

    expect(actual).toBe(ChatResolution.NeedsLogin);
  });

  it('prefers needs-login over a hit from another tool in the same turn', () => {
    const actual = resolveOutcome(
      sourcesWith({ callCount: 2, hitCount: 1, needsSignIn: true }),
      false,
    );

    expect(actual).toBe(ChatResolution.NeedsLogin);
  });

  it('is an error whatever else happened, because nothing else is trustworthy', () => {
    const actual = resolveOutcome(
      sourcesWith({ callCount: 2, hitCount: 2, needsSignIn: true }),
      true,
    );

    expect(actual).toBe(ChatResolution.Error);
  });

  it('never reports answered for a turn in which nothing was found', () => {
    for (const inputSources of [
      sourcesWith({}),
      sourcesWith({ callCount: 3 }),
      sourcesWith({ callCount: 1, needsSignIn: true }),
    ]) {
      expect(resolveOutcome(inputSources, false)).not.toBe(
        ChatResolution.Answered,
      );
    }
  });
});
