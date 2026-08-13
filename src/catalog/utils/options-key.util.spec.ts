import { buildOptionsKey } from './options-key.util';

describe('buildOptionsKey', () => {
  it('returns an empty key for a variant with no options', () => {
    expect(buildOptionsKey([])).toBe('');
    expect(buildOptionsKey()).toBe('');
  });

  it('is independent of the order the values arrive in', () => {
    const inputRed = 'aaaaaaaa-0000-4000-8000-000000000001';
    const inputMedium = 'bbbbbbbb-0000-4000-8000-000000000002';

    expect(buildOptionsKey([inputRed, inputMedium])).toBe(
      buildOptionsKey([inputMedium, inputRed]),
    );
  });

  it('joins the sorted ids with a colon', () => {
    expect(buildOptionsKey(['b', 'a', 'c'])).toBe('a:b:c');
  });

  it('does not mutate the input array', () => {
    const inputIds = ['b', 'a'];
    buildOptionsKey(inputIds);
    expect(inputIds).toEqual(['b', 'a']);
  });

  it('is stable across calls', () => {
    expect(buildOptionsKey(['x', 'y'])).toBe(buildOptionsKey(['x', 'y']));
  });
});
