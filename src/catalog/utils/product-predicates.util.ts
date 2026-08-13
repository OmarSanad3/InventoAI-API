import {
  PRODUCT_CATEGORIES_TABLE,
  PRODUCT_DESCRIPTIVE_VALUES_TABLE,
  SEARCH_TEXT_CONFIG,
  VARIANT_ATTRIBUTE_VALUES_TABLE,
} from '../catalog.constants';

/** One `andWhere` argument pair, ready to hand to a query builder. */
export interface QueryPredicate {
  readonly sql: string;
  readonly parameters: Record<string, unknown>;
}

/** A facet from `?attributes=` after its key and values resolved to real rows. */
export interface ResolvedFacet {
  readonly key: string;
  /** Axis values live on the variants; descriptive ones on the product. */
  readonly isVariantAxis: boolean;
  readonly valueIds: readonly string[];
}

export interface PublicProductFilters {
  readonly categorySlug?: string;
  readonly minPrice?: number;
  readonly maxPrice?: number;
  readonly inStock?: boolean;
  /** Already sanitised by `buildSearchQuery`; safe to interpolate. */
  readonly tsquery?: string | null;
  readonly facets?: readonly ResolvedFacet[];
  /**
   * The facet to leave out. The sidebar excludes a facet from its **own** counts
   * so that, having picked Red, the shopper can still see how many Blue items
   * there are — otherwise every other colour reads `0` and they cannot switch.
   */
  readonly exceptFacetKey?: string;
}

/**
 * Composes the storefront listing's filters into where-clauses.
 *
 * Pure and repository-free, so the composition can be asserted without a
 * database — the listing is the catalog's hottest query and its clauses are
 * where a tenant leak would hide.
 *
 * The store, status and soft-delete predicates are **not** here: they are
 * mandatory rather than optional, and the services apply them unconditionally.
 */
export function buildPublicProductPredicates(
  alias: string,
  filters: PublicProductFilters,
): QueryPredicate[] {
  const predicates: QueryPredicate[] = [];

  if (filters.categorySlug) {
    predicates.push({
      sql: `EXISTS (
        SELECT 1 FROM ${PRODUCT_CATEGORIES_TABLE} link
        JOIN categories category ON category.id = link."categoryId"
        WHERE link."productId" = ${alias}.id
          AND category.slug = :categorySlug
          AND category."isPublished" = true
          AND category."deletedAt" IS NULL
      )`,
      parameters: { categorySlug: filters.categorySlug },
    });
  }

  if (filters.minPrice !== undefined) {
    predicates.push({
      sql: `${alias}."minPriceAmount" >= :minPrice`,
      parameters: { minPrice: filters.minPrice },
    });
  }

  if (filters.maxPrice !== undefined) {
    predicates.push({
      sql: `${alias}."minPriceAmount" <= :maxPrice`,
      parameters: { maxPrice: filters.maxPrice },
    });
  }

  if (filters.inStock) {
    predicates.push({ sql: `${alias}."totalStock" > 0`, parameters: {} });
  }

  if (filters.tsquery) {
    predicates.push({
      sql: `${alias}."searchVector" @@ to_tsquery('${SEARCH_TEXT_CONFIG}', :tsquery)`,
      parameters: { tsquery: filters.tsquery },
    });
  }

  // One EXISTS per facet, AND-ed. Each is an indexed lookup on the join table's
  // `attributeValueId`, and EXISTS short-circuits — which a JOIN plus
  // `GROUP BY ... HAVING COUNT` would not, as facets multiply.
  (filters.facets ?? [])
    .filter((facet) => facet.key !== filters.exceptFacetKey)
    .forEach((facet, index) => {
      predicates.push(buildFacetPredicate(alias, facet, index));
    });

  return predicates;
}

function buildFacetPredicate(
  alias: string,
  facet: ResolvedFacet,
  index: number,
): QueryPredicate {
  const parameter = `facetValues${index}`;

  const sql = facet.isVariantAxis
    ? `EXISTS (
        SELECT 1 FROM product_variants variant
        JOIN ${VARIANT_ATTRIBUTE_VALUES_TABLE} link ON link."variantId" = variant.id
        WHERE variant."productId" = ${alias}.id
          AND variant."deletedAt" IS NULL
          AND link."attributeValueId" IN (:...${parameter})
      )`
    : `EXISTS (
        SELECT 1 FROM ${PRODUCT_DESCRIPTIVE_VALUES_TABLE} link
        WHERE link."productId" = ${alias}.id
          AND link."attributeValueId" IN (:...${parameter})
      )`;

  return { sql, parameters: { [parameter]: [...facet.valueIds] } };
}
