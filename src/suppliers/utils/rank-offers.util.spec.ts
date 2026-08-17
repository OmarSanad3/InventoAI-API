import { rankOffers, type RankableOffer } from './rank-offers.util';

/** A priced offer, with only the field under test varying. */
function buildOffer(overrides: Partial<RankableOffer> = {}): RankableOffer {
  return {
    id: 'offer-1',
    unitAmount: 10_000,
    quantity: 10,
    deliveryDays: 7,
    createdAt: new Date('2026-08-01T10:00:00Z'),
    ...overrides,
  };
}

describe('rankOffers', () => {
  it('ranks the cheapest total first and recommends it', () => {
    const inputOffers = [
      buildOffer({ id: 'expensive', unitAmount: 12_000 }),
      buildOffer({ id: 'cheap', unitAmount: 9_000 }),
    ];

    const actual = rankOffers({
      offers: inputOffers,
      requestedQuantity: 10,
      neededWithinDays: null,
    });

    expect(actual.get('cheap')).toMatchObject({
      rank: 1,
      isRecommended: true,
      isCheapest: true,
      totalAmount: 90_000,
    });
    expect(actual.get('expensive')).toMatchObject({
      rank: 2,
      isRecommended: false,
      isCheapest: false,
    });
  });

  it('compares totals, not unit prices — a bigger pack can win', () => {
    const inputOffers = [
      buildOffer({ id: 'cheap-unit', unitAmount: 1_000, quantity: 100 }),
      buildOffer({ id: 'dear-unit', unitAmount: 5_000, quantity: 10 }),
    ];

    const actual = rankOffers({
      offers: inputOffers,
      requestedQuantity: 10,
      neededWithinDays: null,
    });

    expect(actual.get('dear-unit')?.totalAmount).toBe(50_000);
    expect(actual.get('cheap-unit')?.totalAmount).toBe(100_000);
    expect(actual.get('dear-unit')?.isRecommended).toBe(true);
  });

  it('prices an offer that quoted no quantity for the quantity requested', () => {
    const inputOffers = [buildOffer({ id: 'per-unit', quantity: null })];

    const actual = rankOffers({
      offers: inputOffers,
      requestedQuantity: 25,
      neededWithinDays: null,
    });

    expect(actual.get('per-unit')?.totalAmount).toBe(250_000);
  });

  it('puts a late offer behind an on-time one, however cheap it is', () => {
    const inputOffers = [
      buildOffer({ id: 'late-cheap', unitAmount: 5_000, deliveryDays: 30 }),
      buildOffer({ id: 'on-time', unitAmount: 20_000, deliveryDays: 5 }),
    ];

    const actual = rankOffers({
      offers: inputOffers,
      requestedQuantity: 10,
      neededWithinDays: 10,
    });

    expect(actual.get('on-time')).toMatchObject({
      rank: 1,
      isRecommended: true,
      isLate: false,
    });
    expect(actual.get('late-cheap')).toMatchObject({
      rank: 2,
      isRecommended: false,
      isLate: true,
    });
  });

  it('flags the cheapest and the fastest even when neither is recommended', () => {
    const inputOffers = [
      buildOffer({ id: 'late-cheap', unitAmount: 5_000, deliveryDays: 30 }),
      buildOffer({ id: 'on-time', unitAmount: 20_000, deliveryDays: 9 }),
      buildOffer({ id: 'late-fast', unitAmount: 30_000, deliveryDays: 2 }),
    ];

    const actual = rankOffers({
      offers: inputOffers,
      requestedQuantity: 10,
      neededWithinDays: 10,
    });

    expect(actual.get('on-time')?.isRecommended).toBe(true);
    expect(actual.get('on-time')?.isCheapest).toBe(false);
    expect(actual.get('on-time')?.isFastest).toBe(false);
    expect(actual.get('late-cheap')?.isCheapest).toBe(true);
    expect(actual.get('late-fast')?.isFastest).toBe(true);
  });

  it('never ranks or recommends an offer with no price', () => {
    const inputOffers = [
      buildOffer({ id: 'awaiting', unitAmount: null, deliveryDays: null }),
      buildOffer({ id: 'priced' }),
    ];

    const actual = rankOffers({
      offers: inputOffers,
      requestedQuantity: 10,
      neededWithinDays: null,
    });

    expect(actual.get('awaiting')).toMatchObject({
      rank: null,
      totalAmount: null,
      isRecommended: false,
      isCheapest: false,
    });
    expect(actual.get('priced')?.rank).toBe(1);
  });

  it('recommends nothing when no offer has a price', () => {
    const inputOffers = [
      buildOffer({ id: 'a', unitAmount: null }),
      buildOffer({ id: 'b', unitAmount: null }),
    ];

    const actual = rankOffers({
      offers: inputOffers,
      requestedQuantity: 10,
      neededWithinDays: 5,
    });

    expect([...actual.values()].some((entry) => entry.isRecommended)).toBe(
      false,
    );
  });

  it('breaks a tie on delivery time, then on age', () => {
    const inputOffers = [
      buildOffer({
        id: 'slow',
        deliveryDays: 12,
        createdAt: new Date('2026-08-01T09:00:00Z'),
      }),
      buildOffer({
        id: 'fast',
        deliveryDays: 3,
        createdAt: new Date('2026-08-01T11:00:00Z'),
      }),
      buildOffer({
        id: 'fast-and-older',
        deliveryDays: 3,
        createdAt: new Date('2026-08-01T08:00:00Z'),
      }),
    ];

    const actual = rankOffers({
      offers: inputOffers,
      requestedQuantity: 10,
      neededWithinDays: null,
    });

    expect(actual.get('fast-and-older')?.rank).toBe(1);
    expect(actual.get('fast')?.rank).toBe(2);
    expect(actual.get('slow')?.rank).toBe(3);
  });

  it('cannot make an offer late when no deadline was set', () => {
    const inputOffers = [buildOffer({ deliveryDays: 300 })];

    const actual = rankOffers({
      offers: inputOffers,
      requestedQuantity: 10,
      neededWithinDays: null,
    });

    expect(actual.get('offer-1')?.isLate).toBe(false);
  });

  it('returns nothing for an empty list', () => {
    const actual = rankOffers({
      offers: [],
      requestedQuantity: 10,
      neededWithinDays: 10,
    });

    expect(actual.size).toBe(0);
  });
});
