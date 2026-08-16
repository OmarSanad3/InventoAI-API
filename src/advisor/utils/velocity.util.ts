import {
  RESTOCK_COVERAGE_DAYS,
  TRENDING_MIN_UNITS,
  TRENDING_RATIO,
} from '../advisor.constants';

/**
 * The arithmetic the whole feature rests on, extracted so it can be trusted
 * without a database — the project's habit for any rule worth trusting.
 *
 * None of this is a forecast. It is a rate, a comparison of two rates, and a
 * subtraction; that is what six weeks of orders can honestly support, and the
 * naming keeps it from being mistaken for anything cleverer.
 */

/** Units sold per day over a window. An empty window is `0`, never a NaN. */
export function calculateVelocity({
  units,
  days,
}: {
  units: number;
  days: number;
}): number {
  if (days <= 0 || units <= 0) {
    return 0;
  }
  return units / days;
}

export interface RestockRecommendation {
  /** How long the shelf lasts at the current rate. `null` if nothing sells. */
  daysOfCoverage: number | null;
  /** Units to order so the shelf survives the lead time and then some. */
  recommendedQuantity: number;
  needsRestock: boolean;
}

/**
 * What to order, and whether to bother.
 *
 * The horizon a reorder has to clear is `leadTimeDays + coverageDays`: the
 * delivery it is racing, plus the stretch it should cover once it has arrived.
 * A variant that sells nothing is never a restock — it is a `slow_mover`, and
 * telling an owner to reorder something nobody buys is worse than silence.
 */
export function recommendRestock({
  stockQuantity,
  unitsPerDay,
  leadTimeDays,
  coverageDays = RESTOCK_COVERAGE_DAYS,
}: {
  stockQuantity: number;
  unitsPerDay: number;
  leadTimeDays: number;
  coverageDays?: number;
}): RestockRecommendation {
  if (unitsPerDay <= 0) {
    return {
      daysOfCoverage: null,
      recommendedQuantity: 0,
      needsRestock: false,
    };
  }

  const horizonDays = Math.max(0, leadTimeDays) + Math.max(0, coverageDays);
  const daysOfCoverage = stockQuantity / unitsPerDay;
  const target = unitsPerDay * horizonDays;

  // Always up: half a unit short is a stock-out, and nobody orders 12.4 mugs.
  const recommendedQuantity = Math.max(
    0,
    Math.ceil(target - Math.max(0, stockQuantity)),
  );

  return {
    daysOfCoverage,
    recommendedQuantity,
    needsRestock: daysOfCoverage < horizonDays && recommendedQuantity > 0,
  };
}

export interface TrendVerdict {
  isTrending: boolean;
  /** `null` when nothing sold in the baseline — see `TrendingPayload.ratio`. */
  ratio: number | null;
  recentRate: number;
  baselineRate: number;
}

/**
 * Is it selling materially faster than it was?
 *
 * Two conditions, and the second is the one that matters: without a floor on
 * the recent units, "1 unit last month, 3 units this month" is a 3× trend —
 * which is noise wearing a percentage, and the fastest way to make a brief
 * untrustworthy.
 */
export function detectTrending({
  recentUnits,
  recentDays,
  baselineUnits,
  baselineDays,
  minUnits = TRENDING_MIN_UNITS,
  minRatio = TRENDING_RATIO,
}: {
  recentUnits: number;
  recentDays: number;
  baselineUnits: number;
  baselineDays: number;
  minUnits?: number;
  minRatio?: number;
}): TrendVerdict {
  const recentRate = calculateVelocity({
    units: recentUnits,
    days: recentDays,
  });
  const baselineRate = calculateVelocity({
    units: baselineUnits,
    days: baselineDays,
  });

  const hasVolume = recentUnits >= minUnits;
  // A zero baseline is a real trend and an undefined ratio at the same time.
  const ratio = baselineRate > 0 ? recentRate / baselineRate : null;
  const isTrending =
    hasVolume && recentRate > 0 && (ratio === null || ratio >= minRatio);

  return { isTrending, ratio, recentRate, baselineRate };
}
