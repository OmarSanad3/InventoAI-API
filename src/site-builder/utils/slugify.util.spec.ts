import { SLUG_MAX_LENGTH } from '../site-builder.constants';
import { SLUG_FALLBACK, slugify } from './slugify.util';

describe('slugify', () => {
  it('lowercases and hyphenates a business name', () => {
    expect(slugify('Sanad Toys')).toBe('sanad-toys');
    expect(slugify("Omar's  Gadgets & More!")).toBe('omar-s-gadgets-more');
  });

  it('strips diacritics instead of dropping the letters', () => {
    expect(slugify('Café Crème')).toBe('cafe-creme');
  });

  it('never exceeds the slug length limit or ends in a hyphen', () => {
    const actual = slugify('a'.repeat(SLUG_MAX_LENGTH + 10));

    expect(actual.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(actual.endsWith('-')).toBe(false);
  });

  it('falls back when the name has no Latin characters to slugify', () => {
    expect(slugify('مدينة الألعاب')).toBe(SLUG_FALLBACK);
  });
});
