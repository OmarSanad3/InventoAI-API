import { AdvisorInsightKind } from '../enums/advisor-insight-kind.enum';
import { AdvisorSeverity } from '../enums/advisor-severity.enum';

/**
 * What a collector produces, and the only place a number in this feature is
 * allowed to come from.
 *
 * A signal carries no prose. The narrator turns it into sentences and
 * `buildFallbackSentence` does the same job offline, but neither may change a
 * figure — which is why the payload travels all the way to the row.
 */

/** A product's own facts, repeated in every payload that names one. */
interface ProductRef {
  productId: string;
  productTitle: string;
}

/** A variant's, for the two kinds that are really about a shelf. */
interface VariantRef extends ProductRef {
  variantId: string;
  /** Attribute **labels**, as an order snapshot stores them: `Size: M`. */
  variantLabel: string | null;
}

export interface StockoutPayload extends VariantRef {
  unitsSoldRecent: number;
  /** Minor units per day, from the rate it was selling at before it ran out. */
  estimatedDailyLoss: number;
}

export interface RestockPayload extends VariantRef {
  stockQuantity: number;
  unitsPerDay: number;
  daysOfCoverage: number;
  recommendedQuantity: number;
  leadTimeDays: number;
}

export interface TrendingPayload extends ProductRef {
  recentUnits: number;
  baselineUnits: number;
  /**
   * `null` when nothing sold in the baseline window. Not `Infinity`: this ends
   * up in `jsonb`, and `JSON.stringify(Infinity)` is `null` anyway — better an
   * absence the sentence can say out loud than one that arrived by accident.
   */
  ratio: number | null;
}

export interface SlowMoverPayload extends ProductRef {
  stockQuantity: number;
  /** Minor units sitting on the shelf. */
  tiedUpAmount: number;
  /** `null` when it has never sold at all. */
  daysSinceLastSale: number | null;
}

export interface DemandGapPayload {
  label: string;
  occurrences: number;
  exampleQuestion: string;
  lastAskedAt: Date;
}

export interface SeasonalEventPayload {
  eventKey: string;
  eventName: string;
  /** `YYYY-MM-DD` in the store's own timezone. */
  startsOn: string;
  daysUntil: number;
  matchedCategoryIds: string[];
  matchedCategoryNames: string[];
}

export type WeatherAnomaly = 'heatwave' | 'cold_snap' | 'rain';

export interface WeatherPayload {
  anomaly: WeatherAnomaly;
  maxTempC: number;
  minTempC: number;
  precipitationMm: number;
  /** `YYYY-MM-DD`. */
  onDate: string;
}

/** The payload each kind carries, so a `switch` on `kind` narrows it. */
export interface AdvisorPayloadMap {
  [AdvisorInsightKind.Stockout]: StockoutPayload;
  [AdvisorInsightKind.Restock]: RestockPayload;
  [AdvisorInsightKind.Trending]: TrendingPayload;
  [AdvisorInsightKind.SlowMover]: SlowMoverPayload;
  [AdvisorInsightKind.DemandGap]: DemandGapPayload;
  [AdvisorInsightKind.SeasonalEvent]: SeasonalEventPayload;
  [AdvisorInsightKind.Weather]: WeatherPayload;
}

interface SignalOf<K extends AdvisorInsightKind> {
  readonly kind: K;
  readonly severity: AdvisorSeverity;
  /**
   * Stable across days, derived from the **thing** the advice is about and
   * never from its wording — the prose changes every run.
   */
  readonly dedupeKey: string;
  /**
   * Money at stake, in minor units. The second sort key, and an estimate the
   * collector owns: a stockout of a 2 000 EGP item outranks a 40 EGP one.
   */
  readonly impactAmount: number;
  /**
   * A magnitude for kinds that have no money figure — a demand gap's
   * occurrences, and nothing else so far.
   *
   * Compared **only after `kind` has already matched**, so it can never be
   * weighed against a number in different units. Without it every demand gap
   * ties at `impactAmount: 0` and "asked 40 times" sorts alphabetically below
   * "asked 3 times", which is the one ordering that would make the feed look
   * broken.
   */
  readonly rankWithin?: number;
  readonly payload: AdvisorPayloadMap[K];
}

/** The discriminated union every collector returns and the ranker sorts. */
export type AdvisorSignal = {
  [K in AdvisorInsightKind]: SignalOf<K>;
}[AdvisorInsightKind];
