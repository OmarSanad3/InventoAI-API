/**
 * Where a purchase request is in its life.
 *
 * The same shape `OrderStatus` has, and for the same reason: a request is a
 * record of money the store is about to spend, so it is never deleted — it is
 * cancelled, and the row stays.
 */
export enum PurchaseRequestStatus {
  /** Drafted, editable, nothing sent. */
  Draft = 'draft',
  /** At least one supplier has been mailed. */
  Sent = 'sent',
  /** At least one supplier has answered. */
  Replied = 'replied',
  /** The owner picked an offer; both emails have gone out. */
  Confirmed = 'confirmed',
  Cancelled = 'cancelled',
}
