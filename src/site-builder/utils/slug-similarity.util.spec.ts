import { buildSlugVariants, isConfusableSlug } from './slug-similarity.util';

describe('isConfusableSlug', () => {
  it('flags the plural of an existing slug', () => {
    expect(isConfusableSlug('toys-city', 'toys-cities')).toBe(true);
  });

  it('flags a slug that only differs by hyphens', () => {
    expect(isConfusableSlug('toys-city', 'toyscity')).toBe(true);
  });

  it('flags a one-character typo', () => {
    expect(isConfusableSlug('toys-city', 'toys-citi')).toBe(true);
  });

  it('leaves genuinely different names alone', () => {
    expect(isConfusableSlug('toys-city', 'gadget-hub')).toBe(false);
    expect(isConfusableSlug('toys-city', 'toys-city-cairo')).toBe(false);
  });
});

describe('buildSlugVariants', () => {
  it('includes the singular, the plural and the hyphen-free spelling', () => {
    const actual = buildSlugVariants('toy-store');

    expect(actual).toContain('toy-store');
    expect(actual).toContain('toystore');
    expect(actual).toContain('toy-stores');
  });

  it('derives the singular from a plural slug', () => {
    expect(buildSlugVariants('toy-cities')).toContain('toy-city');
    expect(buildSlugVariants('toy-boxes')).toContain('toy-box');
  });
});
