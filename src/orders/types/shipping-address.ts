/**
 * Where the order goes. Stored as `jsonb` on the order rather than as a table of
 * its own: an address on an order is a **snapshot**, not a record the customer
 * edits afterwards, and no query ever filters by one field of it.
 */
export interface ShippingAddress {
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly governorate: string | null;
  readonly postalCode: string | null;
  /** ISO 3166-1 alpha-2, uppercase. */
  readonly country: string;
}
