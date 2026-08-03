import { slugifyToken } from './slugify-token.util';

const options = { fallback: 'value', maxLength: 60 };

describe('slugifyToken', () => {
  it('keeps a one-character size as itself', () => {
    expect(slugifyToken({ ...options, text: 'S' })).toBe('s');
    expect(slugifyToken({ ...options, text: 'XL' })).toBe('xl');
  });

  it('lowercases and hyphenates a multi-word value', () => {
    expect(slugifyToken({ ...options, text: 'Extra Large' })).toBe(
      'extra-large',
    );
  });

  it('strips diacritics', () => {
    expect(slugifyToken({ ...options, text: 'Café Crème' })).toBe('cafe-creme');
  });

  it('collapses punctuation into single hyphens', () => {
    expect(slugifyToken({ ...options, text: '  Red / Blue!! ' })).toBe(
      'red-blue',
    );
  });

  it('falls back when nothing Latin survives', () => {
    expect(slugifyToken({ ...options, text: 'أحمر' })).toBe('value');
    expect(
      slugifyToken({ text: '—', fallback: 'attribute', maxLength: 40 }),
    ).toBe('attribute');
  });

  it('truncates without leaving a trailing hyphen', () => {
    expect(
      slugifyToken({ ...options, text: 'stone washed denim', maxLength: 12 }),
    ).toBe('stone-washed');
  });
});
