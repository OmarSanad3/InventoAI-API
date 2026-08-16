import { normalizeVector, toVectorLiteral } from './normalize-vector.util';

const magnitudeOf = (values: readonly number[]): number =>
  Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));

describe('normalizeVector', () => {
  it('scales to unit length', () => {
    const actual = normalizeVector([3, 4]);

    expect(actual).toEqual([0.6, 0.8]);
    expect(magnitudeOf(actual)).toBeCloseTo(1, 10);
  });

  it('leaves an already normalised vector where it is', () => {
    expect(normalizeVector([0, 1, 0])).toEqual([0, 1, 0]);
  });

  it('preserves direction, so two parallel vectors normalise to the same point', () => {
    expect(normalizeVector([1, 2, 2])).toEqual(normalizeVector([10, 20, 20]));
  });

  it('returns a zero vector unchanged rather than a vector of NaN', () => {
    expect(normalizeVector([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('handles negative components', () => {
    expect(magnitudeOf(normalizeVector([-3, 4]))).toBeCloseTo(1, 10);
  });
});

describe('toVectorLiteral', () => {
  it('renders the bracketed form pgvector parses', () => {
    expect(toVectorLiteral([0.1, -0.2, 0.3])).toBe('[0.1,-0.2,0.3]');
  });
});
