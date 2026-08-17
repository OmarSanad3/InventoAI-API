/** One offer, reduced to what a comparison needs. */
export interface RankableOffer {
  readonly id: string;
  /** Minor units, or `null` while nobody has quoted a price. */
  readonly unitAmount: number | null;
  /** What the supplier offered, which is not always what was asked for. */
  readonly quantity: number | null;
  readonly deliveryDays: number | null;
  /** The tie-break of last resort, so two identical offers still sort stably. */
  readonly createdAt: Date;
}

/** What the dashboard renders beside each row. */
export interface OfferRanking {
  /** `unitAmount × quantity`, in minor units. `null` when there is no price. */
  readonly totalAmount: number | null;
  /** 1-based position among the priced offers; `null` for the unpriced ones. */
  readonly rank: number | null;
  readonly isRecommended: boolean;
  readonly isCheapest: boolean;
  readonly isFastest: boolean;
  readonly isLate: boolean;
}

export interface RankOffersOptions {
  readonly offers: readonly RankableOffer[];
  /** What the request asked for — the quantity an offer that omitted one gets. */
  readonly requestedQuantity: number;
  /** `null` means the owner set no deadline, so no offer can be late. */
  readonly neededWithinDays: number | null;
}

interface ScoredOffer {
  readonly offer: RankableOffer;
  readonly totalAmount: number | null;
  readonly isLate: boolean;
}

/**
 * The side-by-side comparison, and it is arithmetic rather than an opinion.
 *
 * **Deliberately not an AI call.** The number an owner is about to spend money
 * from has to be reproducible and testable, which is the same rule the Advisor
 * follows when it measures every figure before the model writes a word about
 * it.
 *
 * The order is: priced before unpriced, on-time before late, then cheapest,
 * then fastest, then oldest. The first row is the recommendation —
 * `isCheapest` and `isFastest` are flagged separately and on purpose, so an
 * owner can see at a glance when the recommendation is neither, instead of
 * wondering whether the sort is broken.
 *
 * An offer with no price is **unrankable**, not last-with-a-zero: a supplier
 * who has not answered and a reply the model could not read are both facts the
 * owner needs on screen, and neither is a deal worth zero.
 */
export function rankOffers({
  offers,
  requestedQuantity,
  neededWithinDays,
}: RankOffersOptions): Map<string, OfferRanking> {
  const scored = offers.map<ScoredOffer>((offer) => ({
    offer,
    totalAmount: calculateTotal(offer, requestedQuantity),
    isLate:
      neededWithinDays !== null &&
      offer.deliveryDays !== null &&
      offer.deliveryDays > neededWithinDays,
  }));

  const priced = scored
    .filter((entry) => entry.totalAmount !== null)
    .sort(byBestDeal);

  const cheapest = minOf(priced.map((entry) => entry.totalAmount));
  const fastest = minOf(priced.map((entry) => entry.offer.deliveryDays));

  const rankings = new Map<string, OfferRanking>();

  for (const entry of scored) {
    const rank = priced.indexOf(entry);
    rankings.set(entry.offer.id, {
      totalAmount: entry.totalAmount,
      rank: rank === -1 ? null : rank + 1,
      isRecommended: rank === 0,
      isCheapest: cheapest !== null && entry.totalAmount === cheapest,
      isFastest: fastest !== null && entry.offer.deliveryDays === fastest,
      isLate: entry.isLate,
    });
  }

  return rankings;
}

/**
 * An offer that quoted no quantity is quoting for the quantity it was asked
 * about — otherwise a supplier who answered "249 each" would have no total at
 * all, which is the most common reply there is.
 */
function calculateTotal(
  offer: RankableOffer,
  requestedQuantity: number,
): number | null {
  if (offer.unitAmount === null) {
    return null;
  }
  return offer.unitAmount * (offer.quantity ?? requestedQuantity);
}

function byBestDeal(a: ScoredOffer, b: ScoredOffer): number {
  if (a.isLate !== b.isLate) {
    return a.isLate ? 1 : -1;
  }

  const byTotal = (a.totalAmount ?? 0) - (b.totalAmount ?? 0);
  if (byTotal !== 0) {
    return byTotal;
  }

  const byDelivery =
    (a.offer.deliveryDays ?? Number.MAX_SAFE_INTEGER) -
    (b.offer.deliveryDays ?? Number.MAX_SAFE_INTEGER);
  if (byDelivery !== 0) {
    return byDelivery;
  }

  const byAge = a.offer.createdAt.getTime() - b.offer.createdAt.getTime();
  return byAge !== 0 ? byAge : a.offer.id.localeCompare(b.offer.id);
}

function minOf(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? Math.min(...present) : null;
}
