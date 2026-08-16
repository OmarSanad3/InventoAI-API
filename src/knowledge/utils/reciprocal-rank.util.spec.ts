import { RRF_K } from '../knowledge.constants';
import { fuseByReciprocalRank } from './reciprocal-rank.util';

const idsOf = (results: { id: string }[]): string[] =>
  results.map((result) => result.id);

describe('fuseByReciprocalRank', () => {
  it('keeps a single list in its original order', () => {
    const actual = fuseByReciprocalRank([['a', 'b', 'c']]);

    expect(idsOf(actual)).toEqual(['a', 'b', 'c']);
  });

  it('scores by position only', () => {
    const [first] = fuseByReciprocalRank([['a']]);

    expect(first.score).toBeCloseTo(1 / (RRF_K + 1), 10);
  });

  it('lifts a document both lists agree on above either list leader', () => {
    const actual = fuseByReciprocalRank([
      ['vectorOnly', 'agreed'],
      ['lexicalOnly', 'agreed'],
    ]);

    expect(actual[0].id).toBe('agreed');
  });

  it('keeps documents that appear in only one list', () => {
    const actual = fuseByReciprocalRank([['a', 'b'], ['c']]);

    expect(idsOf(actual).sort()).toEqual(['a', 'b', 'c']);
  });

  it('counts a duplicate inside one list once, at its best position', () => {
    const withDuplicate = fuseByReciprocalRank([['a', 'a', 'b']]);
    const withoutDuplicate = fuseByReciprocalRank([['a', 'b']]);

    expect(withDuplicate[0].score).toBeCloseTo(withoutDuplicate[0].score, 10);
    expect(idsOf(withDuplicate)).toEqual(['a', 'b']);
  });

  it('ranks a document seen once at a better position above one seen later', () => {
    const actual = fuseByReciprocalRank([['top', 'middle', 'bottom']]);

    expect(idsOf(actual)).toEqual(['top', 'middle', 'bottom']);
  });

  it('breaks an exact tie on id, so the order never shuffles', () => {
    const actual = fuseByReciprocalRank([['b'], ['a']]);

    expect(actual[0].score).toBeCloseTo(actual[1].score, 10);
    expect(idsOf(actual)).toEqual(['a', 'b']);
  });

  it('is stable — the same inputs fuse to the same order every time', () => {
    const inputLists = [
      ['a', 'b', 'c'],
      ['c', 'b', 'a'],
    ];

    expect(idsOf(fuseByReciprocalRank(inputLists))).toEqual(
      idsOf(fuseByReciprocalRank(inputLists)),
    );
  });

  it('applies the limit after fusing, not before', () => {
    const actual = fuseByReciprocalRank(
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
      1,
    );

    expect(idsOf(actual)).toEqual(['b']);
  });

  it('returns nothing for no lists, and for empty ones', () => {
    expect(fuseByReciprocalRank([])).toEqual([]);
    expect(fuseByReciprocalRank([[], []])).toEqual([]);
  });
});
