import {
  SEARCH_MAX_TOKENS,
  SEARCH_QUERY_MAX_LENGTH,
} from '../catalog.constants';
import { buildSearchQuery } from './search-query.util';

/**
 * A query `to_tsquery` cannot choke on: bare lexemes joined by ` & `, with `:*`
 * on the last one and no operator character anywhere. If anything else survives
 * into the output, the first shopper who types an operator gets a 500.
 */
function expectAcceptableTsquery(actual: string): void {
  const tokens = actual.split(' & ');
  const lastAt = tokens.length - 1;

  tokens.forEach((token, index) => {
    const lexeme = index === lastAt ? token.replace(/:\*$/, '') : token;
    expect(lexeme).toMatch(/^[\p{L}\p{N}]+$/u);
  });
}

describe('buildSearchQuery', () => {
  it('ANDs the words and prefixes only the last one', () => {
    expect(buildSearchQuery('red popco')?.tsquery).toBe('red & popco:*');
  });

  it('prefixes a single word', () => {
    expect(buildSearchQuery('popco')?.tsquery).toBe('popco:*');
  });

  it('keeps the trimmed original as the term', () => {
    expect(buildSearchQuery('  Popcorn Machine  ')?.term).toBe(
      'Popcorn Machine',
    );
  });

  it('strips every tsquery operator rather than escaping it', () => {
    const inputs = [
      'a & b',
      'a | b',
      '!a',
      '(a)',
      'a:*b',
      "'a'",
      'a <-> b',
      'a & b | !c (d):*',
      'a\\b',
    ];

    for (const input of inputs) {
      const actual = buildSearchQuery(input);
      expect(actual).not.toBeNull();
      expectAcceptableTsquery(actual!.tsquery);
    }
  });

  it('splits a hyphenated word the way Postgres indexes it', () => {
    expect(buildSearchQuery('t-shirt (red)')?.tsquery).toBe(
      't & shirt & red:*',
    );
  });

  it('returns null for anything that is not a search', () => {
    const inputs = ['', '   ', '!!!', '&|()', 'a', ' a ', undefined];

    for (const input of inputs) {
      expect(buildSearchQuery(input)).toBeNull();
    }
  });

  it('truncates an over-long term', () => {
    const actual = buildSearchQuery('x'.repeat(SEARCH_QUERY_MAX_LENGTH + 400));

    expect(actual?.term).toHaveLength(SEARCH_QUERY_MAX_LENGTH);
  });

  it('keeps at most SEARCH_MAX_TOKENS words', () => {
    const input = Array.from(
      { length: SEARCH_MAX_TOKENS + 5 },
      (_, index) => `word${index}`,
    ).join(' ');

    expect(buildSearchQuery(input)?.tsquery.split(' & ')).toHaveLength(
      SEARCH_MAX_TOKENS,
    );
  });

  it('leaves Arabic intact', () => {
    expect(buildSearchQuery('قميص قطن')?.tsquery).toBe('قميص & قطن:*');
  });

  it('never produces anything but null or a well-formed query', () => {
    const alphabet = ' &|!()<>:*\'"\\-abcأ1\t\n';
    const randomInput = (): string =>
      Array.from(
        { length: 1 + Math.floor(Math.random() * 30) },
        () => alphabet[Math.floor(Math.random() * alphabet.length)],
      ).join('');

    for (let attempt = 0; attempt < 200; attempt++) {
      const actual = buildSearchQuery(randomInput());
      if (actual === null) {
        continue;
      }
      expectAcceptableTsquery(actual.tsquery);
      expect(actual.tsquery.endsWith(':*')).toBe(true);
    }
  });
});
