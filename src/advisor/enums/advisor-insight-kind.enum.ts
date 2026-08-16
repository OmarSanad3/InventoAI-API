/**
 * What an insight is about, and therefore which collector produced it.
 *
 * The declaration order is the tie-break order in `rankInsights`, so it is not
 * arbitrary: it runs from "money not being made this afternoon" down to
 * "something to think about this month".
 */
export enum AdvisorInsightKind {
  /** Sold out, and it was selling. */
  Stockout = 'stockout',
  /** Not sold out yet, but it will be before a reorder could arrive. */
  Restock = 'restock',
  /** Selling materially faster than it was. */
  Trending = 'trending',
  /** Cash sitting on a shelf. */
  SlowMover = 'slow_mover',
  /** Shoppers asked the assistant for something this store does not sell. */
  DemandGap = 'demand_gap',
  /** Ramadan, Eid, back-to-school — something on the calendar. */
  SeasonalEvent = 'seasonal_event',
  /** A forecast worth merchandising against. */
  Weather = 'weather',
}
