/**
 * One supplier's side of a request.
 *
 * The row exists from the moment the request is created — a recipient with no
 * answer yet is an `awaiting` offer, which is why there is no separate
 * recipients table.
 */
export enum SupplierOfferStatus {
  /** Asked, no reply yet. */
  Awaiting = 'awaiting',
  /** A reply arrived and was read. */
  Received = 'received',
  /** The owner picked this one. */
  Won = 'won',
  /** The owner picked another; a decline email was sent. */
  Declined = 'declined',
}
