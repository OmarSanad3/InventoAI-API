/**
 * Where a product sits in its lifecycle. Distinct from `deletedAt`, which means
 * "the owner removed it" — `archived` means "we stopped selling it", and the row
 * stays visible to reports and to the orders that reference it.
 */
export enum ProductStatus {
  /** Being written, invisible to the storefront. */
  Draft = 'draft',
  /** On sale. */
  Active = 'active',
  /** Discontinued: invisible to shoppers, still reportable. */
  Archived = 'archived',
}
