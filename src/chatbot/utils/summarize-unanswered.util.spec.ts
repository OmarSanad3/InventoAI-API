import {
  buildGroupKey,
  summarizeUnanswered,
  tokenize,
  UnansweredInput,
} from './summarize-unanswered.util';

const MAX_GROUPS = 200;

function makeRow(overrides: Partial<UnansweredInput> = {}): UnansweredInput {
  return {
    id: 'message-1',
    question: 'do you have wireless earbuds',
    askedAt: new Date('2026-08-16T10:00:00Z'),
    clusterKey: null,
    isReviewed: false,
    ...overrides,
  };
}

describe('tokenize', () => {
  it('lowercases, strips punctuation and drops stop words', () => {
    const actual = tokenize('Do you have any Wireless Earbuds?!');

    expect(actual).toEqual(['wireless', 'earbuds']);
  });

  it('keeps the order the shopper typed', () => {
    expect(tokenize('earbuds wireless')).toEqual(['earbuds', 'wireless']);
  });

  it('strips Latin accents so "café" and "cafe" are one token', () => {
    expect(tokenize('café')).toEqual(tokenize('cafe'));
  });

  it('strips Arabic harakat and normalises alef, teh marbuta and alef maqsura', () => {
    const withHarakat = tokenize('سَمّاعات لاسِلكية');
    const without = tokenize('سماعات لاسلكيه');

    expect(withHarakat).toEqual(without);
  });

  it('drops Arabic stop words', () => {
    expect(tokenize('هل عندكم سماعات')).toEqual(['سماعات']);
  });

  it('returns nothing for a question that is only stop words', () => {
    expect(tokenize('do you have?')).toEqual([]);
  });

  it('closes contractions up rather than leaving a stray letter behind', () => {
    expect(tokenize("I'm looking for a leather handbag")).toEqual([
      'leather',
      'handbag',
    ]);
  });

  it('treats a curly apostrophe the same as a straight one', () => {
    expect(tokenize('I’m after a leather handbag')).toEqual(
      tokenize("I'm after a leather handbag"),
    );
  });
});

describe('buildGroupKey', () => {
  it('sorts the tokens so word order does not split a group', () => {
    expect(buildGroupKey(['wireless', 'earbuds'], 'x')).toBe(
      buildGroupKey(['earbuds', 'wireless'], 'x'),
    );
  });

  it('falls back to the whole sentence when every token was a stop word', () => {
    expect(buildGroupKey([], '  Do You Have?  ')).toBe('do you have?');
  });
});

describe('summarizeUnanswered', () => {
  it('collapses three phrasings of one question into one group', () => {
    const inputRows: UnansweredInput[] = [
      makeRow({ id: 'a', question: 'do you have wireless earbuds' }),
      makeRow({ id: 'b', question: 'Wireless earbuds?' }),
      makeRow({ id: 'c', question: 'earbuds, wireless' }),
    ];

    const actual = summarizeUnanswered(inputRows, { maxGroups: MAX_GROUPS });

    expect(actual).toHaveLength(1);
    expect(actual[0].occurrences).toBe(3);
    expect(actual[0].messageIds).toEqual(['a', 'b', 'c']);
  });

  it('labels the group with the shortest phrasing and quotes the most recent verbatim', () => {
    const inputRows: UnansweredInput[] = [
      makeRow({
        id: 'a',
        question: 'do you have any wireless earbuds in stock',
        askedAt: new Date('2026-08-14T10:00:00Z'),
      }),
      makeRow({
        id: 'b',
        question: 'Wireless Earbuds?',
        askedAt: new Date('2026-08-16T10:00:00Z'),
      }),
    ];

    const actual = summarizeUnanswered(inputRows, { maxGroups: MAX_GROUPS });

    expect(actual[0].label).toBe('wireless earbuds');
    expect(actual[0].exampleQuestion).toBe('Wireless Earbuds?');
    expect(actual[0].lastAskedAt).toEqual(new Date('2026-08-16T10:00:00Z'));
  });

  it('keeps genuinely different questions apart', () => {
    const inputRows: UnansweredInput[] = [
      makeRow({ id: 'a', question: 'wireless earbuds' }),
      makeRow({ id: 'b', question: 'leather wallet' }),
    ];

    const actual = summarizeUnanswered(inputRows, { maxGroups: MAX_GROUPS });

    expect(actual).toHaveLength(2);
  });

  it('orders by occurrences, then by the most recent ask', () => {
    const inputRows: UnansweredInput[] = [
      makeRow({
        id: 'a',
        question: 'leather wallet',
        askedAt: new Date('2026-08-16T12:00:00Z'),
      }),
      makeRow({ id: 'b', question: 'wireless earbuds' }),
      makeRow({ id: 'c', question: 'earbuds wireless' }),
    ];

    const actual = summarizeUnanswered(inputRows, { maxGroups: MAX_GROUPS });

    expect(actual.map((group) => group.occurrences)).toEqual([2, 1]);
    expect(actual[0].label).toBe('wireless earbuds');
  });

  it('merges on clusterKey when the nightly pass has assigned one', () => {
    const inputRows: UnansweredInput[] = [
      makeRow({ id: 'a', question: 'wireless earbuds', clusterKey: 'theme-1' }),
      makeRow({ id: 'b', question: 'airpods', clusterKey: 'theme-1' }),
      makeRow({
        id: 'c',
        question: 'سماعات لاسلكية',
        clusterKey: 'theme-1',
      }),
    ];

    const actual = summarizeUnanswered(inputRows, { maxGroups: MAX_GROUPS });

    expect(actual).toHaveLength(1);
    expect(actual[0].key).toBe('theme-1');
    expect(actual[0].occurrences).toBe(3);
  });

  it('carries a question asked since the nightly pass into its twin’s cluster', () => {
    const inputRows: UnansweredInput[] = [
      makeRow({ id: 'a', question: 'wireless earbuds', clusterKey: 'theme-1' }),
      makeRow({ id: 'b', question: 'airpods', clusterKey: 'theme-1' }),
      // Asked after the pass ran, so it has no key of its own — but it is the
      // same phrasing as `a`, which does.
      makeRow({ id: 'c', question: 'Wireless earbuds?', clusterKey: null }),
    ];

    const actual = summarizeUnanswered(inputRows, { maxGroups: MAX_GROUPS });

    expect(actual).toHaveLength(1);
    expect(actual[0].occurrences).toBe(3);
  });

  it('leaves an unclustered question alone until the pass reaches it', () => {
    const inputRows: UnansweredInput[] = [
      makeRow({ id: 'a', question: 'wireless earbuds', clusterKey: 'theme-1' }),
      makeRow({ id: 'b', question: 'airpods', clusterKey: null }),
    ];

    const actual = summarizeUnanswered(inputRows, { maxGroups: MAX_GROUPS });

    expect(actual).toHaveLength(2);
  });

  it('marks a group reviewed only when every occurrence is', () => {
    const inputRows: UnansweredInput[] = [
      makeRow({ id: 'a', question: 'wireless earbuds', isReviewed: true }),
      makeRow({ id: 'b', question: 'earbuds wireless', isReviewed: false }),
    ];

    const actual = summarizeUnanswered(inputRows, { maxGroups: MAX_GROUPS });

    expect(actual[0].isReviewed).toBe(false);
  });

  it('caps the number of groups it returns', () => {
    const inputRows = Array.from({ length: 10 }, (unused, index) =>
      makeRow({ id: `m-${index}`, question: `product number ${index}` }),
    );

    const actual = summarizeUnanswered(inputRows, { maxGroups: 3 });

    expect(actual).toHaveLength(3);
  });

  it('returns nothing for no rows', () => {
    expect(summarizeUnanswered([], { maxGroups: MAX_GROUPS })).toEqual([]);
  });
});
