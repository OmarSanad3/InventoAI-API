/**
 * The direction half of a sortable list endpoint's query string.
 *
 * A union rather than an enum on purpose: TypeORM's `orderBy` takes the literal
 * `'ASC' | 'DESC'`, and a string-enum member is not assignable to a string
 * literal type — an enum here would mean a cast at every call site.
 */
export const SORT_ORDERS = ['ASC', 'DESC'] as const;

export type SortOrder = (typeof SORT_ORDERS)[number];
