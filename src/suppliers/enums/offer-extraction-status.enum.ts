/**
 * How the numbers on an offer got there.
 *
 * `failed` is not an error state — the reply is stored either way. It is what
 * tells the dashboard to show the raw text and ask the owner to fill in the
 * three fields, and what stops a parse failure from looking like a supplier who
 * never answered.
 */
export enum OfferExtractionStatus {
  /** The model read the reply and returned usable fields. */
  Parsed = 'parsed',
  /** The model was called and produced nothing usable. */
  Failed = 'failed',
  /** The owner typed or corrected the numbers themselves. */
  Manual = 'manual',
}
