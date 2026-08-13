/** What the dashboard list may be ordered by. */
export enum ProductSort {
  CreatedAt = 'createdAt',
  Title = 'title',
  MinPrice = 'minPriceAmount',
  TotalStock = 'totalStock',
}

/**
 * What the storefront listing may be ordered by. `relevance` is the default
 * whenever a search term is present, and degrades to `newest` when it is not.
 */
export enum PublicProductSort {
  Relevance = 'relevance',
  Newest = 'newest',
  PriceAsc = 'price_asc',
  PriceDesc = 'price_desc',
  Title = 'title',
}
