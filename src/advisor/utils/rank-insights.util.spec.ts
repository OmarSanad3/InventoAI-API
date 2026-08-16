import { AdvisorInsightKind } from '../enums/advisor-insight-kind.enum';
import { AdvisorSeverity } from '../enums/advisor-severity.enum';
import type { AdvisorSignal } from '../types/advisor-signal.type';
import { rankInsights } from './rank-insights.util';

function buildSignal({
  kind = AdvisorInsightKind.Trending,
  severity = AdvisorSeverity.Info,
  dedupeKey = 'trending:a',
  impactAmount = 0,
}: Partial<Pick<AdvisorSignal, 'severity' | 'dedupeKey' | 'impactAmount'>> & {
  kind?: AdvisorInsightKind;
} = {}): AdvisorSignal {
  return {
    kind,
    severity,
    dedupeKey,
    impactAmount,
    payload: {} as never,
  };
}

describe('rankInsights', () => {
  it('puts a critical insight above a warning, whatever the money says', () => {
    const inputSignals = [
      buildSignal({
        kind: AdvisorInsightKind.Restock,
        severity: AdvisorSeverity.Warning,
        dedupeKey: 'restock:rich',
        impactAmount: 900_000,
      }),
      buildSignal({
        kind: AdvisorInsightKind.Stockout,
        severity: AdvisorSeverity.Critical,
        dedupeKey: 'stockout:cheap',
        impactAmount: 100,
      }),
    ];

    const actual = rankInsights(inputSignals);

    expect(actual[0].dedupeKey).toBe('stockout:cheap');
  });

  it('sorts by money at stake within a severity', () => {
    const inputSignals = [
      buildSignal({
        kind: AdvisorInsightKind.Stockout,
        severity: AdvisorSeverity.Critical,
        dedupeKey: 'stockout:small',
        impactAmount: 4_000,
      }),
      buildSignal({
        kind: AdvisorInsightKind.Stockout,
        severity: AdvisorSeverity.Critical,
        dedupeKey: 'stockout:big',
        impactAmount: 200_000,
      }),
    ];

    const actual = rankInsights(inputSignals);

    expect(actual.map((signal) => signal.dedupeKey)).toEqual([
      'stockout:big',
      'stockout:small',
    ]);
  });

  it('breaks a full tie on kind, then on the dedupe key', () => {
    const inputSignals = [
      buildSignal({
        kind: AdvisorInsightKind.SlowMover,
        dedupeKey: 'slow_mover:a',
      }),
      buildSignal({
        kind: AdvisorInsightKind.Trending,
        dedupeKey: 'trending:z',
      }),
      buildSignal({
        kind: AdvisorInsightKind.Trending,
        dedupeKey: 'trending:a',
      }),
    ];

    const actual = rankInsights(inputSignals);

    expect(actual.map((signal) => signal.dedupeKey)).toEqual([
      'trending:a',
      'trending:z',
      'slow_mover:a',
    ]);
  });

  it('is stable: the same signals ranked twice produce the same brief', () => {
    const inputSignals = [
      buildSignal({ dedupeKey: 'trending:b', impactAmount: 10 }),
      buildSignal({ dedupeKey: 'trending:a', impactAmount: 10 }),
      buildSignal({ dedupeKey: 'trending:c', impactAmount: 10 }),
    ];

    const first = rankInsights(inputSignals).map((signal) => signal.dedupeKey);
    const second = rankInsights([...inputSignals].reverse()).map(
      (signal) => signal.dedupeKey,
    );

    expect(second).toEqual(first);
  });

  it('orders same-kind ties by the kind-local magnitude', () => {
    const inputSignals = [
      {
        ...buildSignal({
          kind: AdvisorInsightKind.DemandGap,
          severity: AdvisorSeverity.Warning,
          dedupeKey: 'demand_gap:a-rarely-asked',
        }),
        rankWithin: 3,
      },
      {
        ...buildSignal({
          kind: AdvisorInsightKind.DemandGap,
          severity: AdvisorSeverity.Warning,
          dedupeKey: 'demand_gap:z-often-asked',
        }),
        rankWithin: 40,
      },
    ] as AdvisorSignal[];

    const actual = rankInsights(inputSignals);

    // Both have no money figure; asked-40-times must not sort alphabetically
    // below asked-3-times.
    expect(actual[0].dedupeKey).toBe('demand_gap:z-often-asked');
  });

  it('caps the brief at the limit it was given', () => {
    const inputSignals = Array.from({ length: 20 }, (_, index) =>
      buildSignal({ dedupeKey: `trending:${index}` }),
    );

    const actual = rankInsights(inputSignals, 8);

    expect(actual).toHaveLength(8);
  });

  it('does not mutate the array it was handed', () => {
    const inputSignals = [
      buildSignal({ dedupeKey: 'trending:z' }),
      buildSignal({ dedupeKey: 'trending:a' }),
    ];

    rankInsights(inputSignals);

    expect(inputSignals[0].dedupeKey).toBe('trending:z');
  });
});
