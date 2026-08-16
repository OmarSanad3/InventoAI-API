import {
  calculateVelocity,
  detectTrending,
  recommendRestock,
} from './velocity.util';

describe('calculateVelocity', () => {
  it('divides units by the days of the window', () => {
    const actual = calculateVelocity({ units: 14, days: 7 });

    expect(actual).toBe(2);
  });

  it('returns 0 for an empty window rather than dividing by zero', () => {
    const actual = calculateVelocity({ units: 5, days: 0 });

    expect(actual).toBe(0);
  });

  it('returns 0 when nothing sold', () => {
    const actual = calculateVelocity({ units: 0, days: 28 });

    expect(actual).toBe(0);
  });

  it('uses the days it was given, so a partial window is not inflated', () => {
    const fullWindow = calculateVelocity({ units: 6, days: 7 });
    const partialWindow = calculateVelocity({ units: 6, days: 3 });

    expect(partialWindow).toBeGreaterThan(fullWindow);
  });
});

describe('recommendRestock', () => {
  const leadTimeDays = 10;

  it('recommends nothing when coverage is beyond the horizon', () => {
    const actual = recommendRestock({
      stockQuantity: 500,
      unitsPerDay: 1,
      leadTimeDays,
    });

    expect(actual.needsRestock).toBe(false);
    expect(actual.recommendedQuantity).toBe(0);
  });

  it('covers the whole horizon when the shelf is empty', () => {
    const actual = recommendRestock({
      stockQuantity: 0,
      unitsPerDay: 2,
      leadTimeDays,
      coverageDays: 14,
    });

    // 2/day over 10 lead-time days + 14 covered days.
    expect(actual.recommendedQuantity).toBe(48);
    expect(actual.needsRestock).toBe(true);
  });

  it('subtracts what is already on the shelf', () => {
    const actual = recommendRestock({
      stockQuantity: 8,
      unitsPerDay: 2,
      leadTimeDays,
      coverageDays: 14,
    });

    expect(actual.recommendedQuantity).toBe(40);
  });

  it('always rounds the quantity up — nobody orders 12.4 mugs', () => {
    const actual = recommendRestock({
      stockQuantity: 0,
      unitsPerDay: 0.5,
      leadTimeDays: 1,
      coverageDays: 0,
    });

    expect(actual.recommendedQuantity).toBe(1);
  });

  it('never recommends restocking something that does not sell', () => {
    const actual = recommendRestock({
      stockQuantity: 0,
      unitsPerDay: 0,
      leadTimeDays,
    });

    expect(actual.needsRestock).toBe(false);
    expect(actual.daysOfCoverage).toBeNull();
    expect(actual.recommendedQuantity).toBe(0);
  });

  it('reports the coverage it measured', () => {
    const actual = recommendRestock({
      stockQuantity: 6,
      unitsPerDay: 2,
      leadTimeDays,
    });

    expect(actual.daysOfCoverage).toBe(3);
  });
});

describe('detectTrending', () => {
  const baselineDays = 28;
  const recentDays = 7;

  it('does not fire on noise wearing a percentage', () => {
    // 3× the rate, and three units. The floor is what rejects it.
    const actual = detectTrending({
      recentUnits: 3,
      recentDays,
      baselineUnits: 4,
      baselineDays,
    });

    expect(actual.isTrending).toBe(false);
  });

  it('fires on a real acceleration with real volume', () => {
    const actual = detectTrending({
      recentUnits: 12,
      recentDays,
      baselineUnits: 16,
      baselineDays,
    });

    // 12/7 vs 16/28 — about 3×.
    expect(actual.isTrending).toBe(true);
    expect(actual.ratio).toBeCloseTo(3);
  });

  it('fires on a zero baseline without dividing by zero', () => {
    const actual = detectTrending({
      recentUnits: 9,
      recentDays,
      baselineUnits: 0,
      baselineDays,
    });

    expect(actual.isTrending).toBe(true);
    expect(actual.ratio).toBeNull();
    expect(Number.isFinite(actual.recentRate)).toBe(true);
  });

  it('does not fire when the rate is merely steady', () => {
    const actual = detectTrending({
      recentUnits: 10,
      recentDays,
      baselineUnits: 40,
      baselineDays,
    });

    expect(actual.isTrending).toBe(false);
    expect(actual.ratio).toBeCloseTo(1);
  });

  it('does not fire when nothing sold at all', () => {
    const actual = detectTrending({
      recentUnits: 0,
      recentDays,
      baselineUnits: 0,
      baselineDays,
    });

    expect(actual.isTrending).toBe(false);
    expect(actual.ratio).toBeNull();
  });
});
