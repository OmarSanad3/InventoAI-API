import { AdvisorInsightKind } from '../enums/advisor-insight-kind.enum';
import { AdvisorSeverity } from '../enums/advisor-severity.enum';
import type { AdvisorSignal } from '../types/advisor-signal.type';
import {
  buildFallbackHeadline,
  buildFallbackSentence,
  formatMoney,
} from './fallback-sentence.util';

const CURRENCY = 'EGP';

/** One signal of each kind, with numbers a sentence can be checked against. */
const SAMPLES: Record<AdvisorInsightKind, AdvisorSignal> = {
  [AdvisorInsightKind.Stockout]: {
    kind: AdvisorInsightKind.Stockout,
    severity: AdvisorSeverity.Critical,
    dedupeKey: 'stockout:v1',
    impactAmount: 12_000,
    payload: {
      productId: 'p1',
      productTitle: 'Teddy Bear XL',
      variantId: 'v1',
      variantLabel: 'Size: M',
      unitsSoldRecent: 7,
      estimatedDailyLoss: 12_000,
    },
  },
  [AdvisorInsightKind.Restock]: {
    kind: AdvisorInsightKind.Restock,
    severity: AdvisorSeverity.Warning,
    dedupeKey: 'restock:v2',
    impactAmount: 40_000,
    payload: {
      productId: 'p1',
      productTitle: 'Teddy Bear XL',
      variantId: 'v2',
      variantLabel: null,
      stockQuantity: 2,
      unitsPerDay: 1.5,
      daysOfCoverage: 1.33,
      recommendedQuantity: 60,
      leadTimeDays: 10,
    },
  },
  [AdvisorInsightKind.Trending]: {
    kind: AdvisorInsightKind.Trending,
    severity: AdvisorSeverity.Info,
    dedupeKey: 'trending:p1',
    impactAmount: 90_000,
    payload: {
      productId: 'p1',
      productTitle: 'Teddy Bear XL',
      recentUnits: 12,
      baselineUnits: 16,
      ratio: 3,
    },
  },
  [AdvisorInsightKind.SlowMover]: {
    kind: AdvisorInsightKind.SlowMover,
    severity: AdvisorSeverity.Info,
    dedupeKey: 'slow_mover:p2',
    impactAmount: 80_000,
    payload: {
      productId: 'p2',
      productTitle: 'Brass Lamp',
      stockQuantity: 20,
      tiedUpAmount: 80_000,
      daysSinceLastSale: 60,
    },
  },
  [AdvisorInsightKind.DemandGap]: {
    kind: AdvisorInsightKind.DemandGap,
    severity: AdvisorSeverity.Warning,
    dedupeKey: 'demand_gap:leather handbag',
    impactAmount: 0,
    payload: {
      label: 'leather handbag',
      occurrences: 4,
      exampleQuestion: 'do you sell a leather handbag?',
      lastAskedAt: new Date('2026-08-16T10:00:00Z'),
    },
  },
  [AdvisorInsightKind.SeasonalEvent]: {
    kind: AdvisorInsightKind.SeasonalEvent,
    severity: AdvisorSeverity.Info,
    dedupeKey: 'seasonal_event:ramadan-1448',
    impactAmount: 0,
    payload: {
      eventKey: 'ramadan',
      eventName: 'Ramadan',
      startsOn: '2027-02-08',
      daysUntil: 21,
      matchedCategoryIds: ['c1'],
      matchedCategoryNames: ['Lanterns'],
    },
  },
  [AdvisorInsightKind.Weather]: {
    kind: AdvisorInsightKind.Weather,
    severity: AdvisorSeverity.Info,
    dedupeKey: 'weather:heatwave:2026-08-20',
    impactAmount: 0,
    payload: {
      anomaly: 'heatwave',
      maxTempC: 41.2,
      minTempC: 28,
      precipitationMm: 0,
      onDate: '2026-08-20',
    },
  },
};

describe('buildFallbackSentence', () => {
  /**
   * The test that matters most: a new kind cannot ship without prose, because
   * a brief that renders a blank line is worse than one that reads plainly.
   */
  it('has a sentence for every insight kind', () => {
    for (const kind of Object.values(AdvisorInsightKind)) {
      const actual = buildFallbackSentence(SAMPLES[kind], CURRENCY);

      expect(actual.title.length).toBeGreaterThan(0);
      expect(actual.body.length).toBeGreaterThan(0);
    }
  });

  it('quotes the numbers it was given rather than inventing any', () => {
    const actual = buildFallbackSentence(
      SAMPLES[AdvisorInsightKind.Restock],
      CURRENCY,
    );

    expect(actual.body).toContain('2 units');
    expect(actual.body).toContain('60');
    expect(actual.body).toContain('10 days');
  });

  it('names the variant when there is one, and does not when there is not', () => {
    const withVariant = buildFallbackSentence(
      SAMPLES[AdvisorInsightKind.Stockout],
      CURRENCY,
    );
    const withoutVariant = buildFallbackSentence(
      SAMPLES[AdvisorInsightKind.Restock],
      CURRENCY,
    );

    expect(withVariant.title).toContain('(Size: M)');
    expect(withoutVariant.title).not.toContain('(');
  });

  it('says a missing baseline out loud instead of printing a ratio', () => {
    const inputSignal: AdvisorSignal = {
      ...SAMPLES[AdvisorInsightKind.Trending],
      payload: {
        ...SAMPLES[AdvisorInsightKind.Trending].payload,
        baselineUnits: 0,
        ratio: null,
      },
    } as AdvisorSignal;

    const actual = buildFallbackSentence(inputSignal, CURRENCY);

    expect(actual.body).toContain('none sold');
    expect(actual.body).not.toContain('null');
    expect(actual.body).not.toContain('Infinity');
  });

  it('handles a product that has never sold', () => {
    const inputSignal: AdvisorSignal = {
      ...SAMPLES[AdvisorInsightKind.SlowMover],
      payload: {
        ...SAMPLES[AdvisorInsightKind.SlowMover].payload,
        daysSinceLastSale: null,
      },
    } as AdvisorSignal;

    const actual = buildFallbackSentence(inputSignal, CURRENCY);

    expect(actual.body).toContain('never sold');
  });

  it('writes each weather anomaly in its own words', () => {
    const coldSignal: AdvisorSignal = {
      ...SAMPLES[AdvisorInsightKind.Weather],
      payload: {
        ...SAMPLES[AdvisorInsightKind.Weather].payload,
        anomaly: 'cold_snap',
        minTempC: 5,
      },
    } as AdvisorSignal;

    const heat = buildFallbackSentence(
      SAMPLES[AdvisorInsightKind.Weather],
      CURRENCY,
    );
    const cold = buildFallbackSentence(coldSignal, CURRENCY);

    expect(heat.title).toContain('41°C');
    expect(cold.title).toContain('5°C');
  });

  it('says "starts today" rather than "starts in 0 days"', () => {
    const inputSignal: AdvisorSignal = {
      ...SAMPLES[AdvisorInsightKind.SeasonalEvent],
      payload: {
        ...SAMPLES[AdvisorInsightKind.SeasonalEvent].payload,
        daysUntil: 0,
      },
    } as AdvisorSignal;

    const actual = buildFallbackSentence(inputSignal, CURRENCY);

    expect(actual.title).toContain('starts today');
  });
});

describe('formatMoney', () => {
  it('turns minor units into something a sentence can hold', () => {
    expect(formatMoney(249_000, 'EGP')).toBe('2,490 EGP');
  });

  it('keeps the piastres when there are any', () => {
    expect(formatMoney(24_950, 'EGP')).toBe('249.50 EGP');
  });

  it('never returns a formatted string for the payload to copy', () => {
    // A guard on intent: money in a payload is an int, money in prose is this.
    expect(formatMoney(0, 'USD')).toBe('0 USD');
  });
});

describe('buildFallbackHeadline', () => {
  it('says nothing needs attention when nothing does', () => {
    expect(buildFallbackHeadline([])).toContain('Nothing needs your attention');
  });

  it('counts the stock lines separately, because those are the urgent ones', () => {
    const actual = buildFallbackHeadline([
      SAMPLES[AdvisorInsightKind.Stockout],
      SAMPLES[AdvisorInsightKind.Restock],
      SAMPLES[AdvisorInsightKind.Trending],
    ]);

    expect(actual).toContain('3 things');
    expect(actual).toContain('2 need stock');
  });

  it('does not mention stock when none of the lines are about it', () => {
    const actual = buildFallbackHeadline([
      SAMPLES[AdvisorInsightKind.Trending],
    ]);

    expect(actual).toContain('1 thing');
    expect(actual).not.toContain('stock');
  });
});
