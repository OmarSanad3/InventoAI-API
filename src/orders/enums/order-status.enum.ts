/**
 * Where an order is in **fulfilment**. Money lives on `PaymentStatus` instead:
 * "shipped but unpaid" (COD) and "paid but not yet shipped" (card) are both
 * normal, and one merged enum would have to enumerate the product of the two.
 */
export enum OrderStatus {
  /** Placed, awaiting the owner. */
  Pending = 'pending',
  /** The owner accepted it. */
  Confirmed = 'confirmed',
  Shipped = 'shipped',
  Delivered = 'delivered',
  Cancelled = 'cancelled',
}
