/** Where an order is in **money**, independently of its fulfilment status. */
export enum PaymentStatus {
  /** COD before delivery — the normal state of a cash order. */
  Unpaid = 'unpaid',
  /** Card, awaiting the provider. Reserved for payments.md. */
  Pending = 'pending',
  Paid = 'paid',
  Failed = 'failed',
  Refunded = 'refunded',
}
