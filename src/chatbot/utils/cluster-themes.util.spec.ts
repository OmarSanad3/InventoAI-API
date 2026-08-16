import {
  ClusterCandidate,
  clusterThemes,
  cosineDistance,
} from './cluster-themes.util';

const THRESHOLD = 0.25;

describe('cosineDistance', () => {
  it('is zero for identical vectors', () => {
    expect(cosineDistance([1, 0, 0], [1, 0, 0])).toBeCloseTo(0);
  });

  it('is one for orthogonal vectors', () => {
    expect(cosineDistance([1, 0], [0, 1])).toBeCloseTo(1);
  });

  it('ignores magnitude, so an unnormalised centroid still compares correctly', () => {
    expect(cosineDistance([1, 0], [7, 0])).toBeCloseTo(0);
  });

  it('returns the maximum distance for a zero vector', () => {
    expect(cosineDistance([0, 0], [1, 0])).toBe(2);
  });

  it('returns the maximum distance for mismatched lengths', () => {
    expect(cosineDistance([1, 0], [1, 0, 0])).toBe(2);
  });
});

describe('clusterThemes', () => {
  function makeCandidate(
    key: string,
    vector: number[],
    occurrences = 1,
  ): ClusterCandidate {
    return { key, vector, occurrences };
  }

  it('merges two groups whose vectors sit inside the threshold', () => {
    const inputCandidates = [
      makeCandidate('earbuds', [1, 0]),
      makeCandidate('airpods', [0.99, 0.14]),
    ];

    const actual = clusterThemes(inputCandidates, { threshold: THRESHOLD });

    expect(actual.get('airpods')).toBe('earbuds');
  });

  it('leaves unrelated groups in clusters of their own', () => {
    const inputCandidates = [
      makeCandidate('earbuds', [1, 0]),
      makeCandidate('wallet', [0, 1]),
    ];

    const actual = clusterThemes(inputCandidates, { threshold: THRESHOLD });

    expect(actual.get('earbuds')).toBe('earbuds');
    expect(actual.get('wallet')).toBe('wallet');
  });

  it('seeds each cluster with the first candidate it is given', () => {
    const inputCandidates = [
      makeCandidate('airpods', [1, 0], 40),
      makeCandidate('earbuds', [1, 0], 1),
    ];

    const actual = clusterThemes(inputCandidates, { threshold: THRESHOLD });

    expect([...actual.values()]).toEqual(['airpods', 'airpods']);
  });

  it('picks the nearest cluster when a candidate is close to two', () => {
    const inputCandidates = [
      // 0.4 apart from `near`, so the two seed clusters of their own; the
      // candidate then sits inside the threshold of both.
      makeCandidate('far', [0.6, 0.8]),
      makeCandidate('near', [1, 0]),
      makeCandidate('candidate', [0.97, 0.243]),
    ];

    const actual = clusterThemes(inputCandidates, { threshold: THRESHOLD });

    expect(actual.get('candidate')).toBe('near');
  });

  it('weights a centroid by occurrences, so one stray phrasing cannot drag it', () => {
    const inputCandidates = [
      makeCandidate('earbuds', [1, 0], 40),
      makeCandidate('nearly', [0.94, 0.34], 1),
      makeCandidate('probe', [1, 0], 1),
    ];

    const actual = clusterThemes(inputCandidates, { threshold: THRESHOLD });

    expect(actual.get('probe')).toBe('earbuds');
  });

  it('assigns nothing for no candidates', () => {
    expect(clusterThemes([], { threshold: THRESHOLD }).size).toBe(0);
  });
});
