import { MAX_SLUG_ATTEMPTS } from '../catalog.constants';
import { buildUniqueSlug } from './unique-slug.util';

describe('buildUniqueSlug', () => {
  it('keeps the candidate when nothing has taken it', () => {
    const actual = buildUniqueSlug({
      candidate: 'summer-sale',
      taken: new Set<string>(),
    });

    expect(actual).toBe('summer-sale');
  });

  it('appends -2 when the candidate is taken', () => {
    const actual = buildUniqueSlug({
      candidate: 'summer-sale',
      taken: new Set(['summer-sale']),
    });

    expect(actual).toBe('summer-sale-2');
  });

  it('appends -3 when -2 is taken as well', () => {
    const actual = buildUniqueSlug({
      candidate: 'summer-sale',
      taken: new Set(['summer-sale', 'summer-sale-2']),
    });

    expect(actual).toBe('summer-sale-3');
  });

  it('skips gaps and takes the lowest free suffix', () => {
    const actual = buildUniqueSlug({
      candidate: 'summer-sale',
      taken: new Set(['summer-sale', 'summer-sale-2', 'summer-sale-4']),
    });

    expect(actual).toBe('summer-sale-3');
  });

  it('falls back to a random suffix once the attempts are exhausted', () => {
    const inputTaken = new Set(['summer-sale']);
    for (let suffix = 2; suffix <= MAX_SLUG_ATTEMPTS; suffix++) {
      inputTaken.add(`summer-sale-${suffix}`);
    }

    const actual = buildUniqueSlug({
      candidate: 'summer-sale',
      taken: inputTaken,
    });

    expect(inputTaken.has(actual)).toBe(false);
    expect(actual).toMatch(/^summer-sale-[0-9a-f]{6}$/);
  });

  it('does not collide with a slug that merely shares the prefix', () => {
    const actual = buildUniqueSlug({
      candidate: 'summer',
      taken: new Set(['summer-sale', 'summer-sale-2']),
    });

    expect(actual).toBe('summer');
  });
});
