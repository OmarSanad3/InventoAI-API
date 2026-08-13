import {
  buildPublicProductPredicates,
  PublicProductFilters,
} from './product-predicates.util';

const inputFacets = [
  { key: 'size', isVariantAxis: true, valueIds: ['size-xl', 'size-l'] },
  { key: 'material', isVariantAxis: false, valueIds: ['material-cotton'] },
];

function buildSql(filters: PublicProductFilters): string {
  return buildPublicProductPredicates('product', filters)
    .map((predicate) => predicate.sql)
    .join(' AND ');
}

describe('buildPublicProductPredicates', () => {
  it('produces nothing when no filter was sent', () => {
    expect(buildPublicProductPredicates('product', {})).toEqual([]);
  });

  it('composes every filter at once', () => {
    const actual = buildPublicProductPredicates('product', {
      categorySlug: 'kitchen',
      minPrice: 1000,
      maxPrice: 9000,
      inStock: true,
      tsquery: 'popcorn:*',
      facets: inputFacets,
    });

    expect(actual).toHaveLength(7);
    const sql = actual.map((predicate) => predicate.sql).join(' AND ');
    expect(sql).toContain('category.slug = :categorySlug');
    expect(sql).toContain('product."minPriceAmount" >= :minPrice');
    expect(sql).toContain('product."minPriceAmount" <= :maxPrice');
    expect(sql).toContain('product."totalStock" > 0');
    expect(sql).toContain(`product."searchVector" @@ to_tsquery('english'`);
  });

  it('collects the parameters each clause needs', () => {
    const actual = buildPublicProductPredicates('product', {
      minPrice: 1000,
      facets: inputFacets,
    });
    const parameters = Object.assign(
      {},
      ...actual.map((predicate) => predicate.parameters),
    ) as Record<string, unknown>;

    expect(parameters.minPrice).toBe(1000);
    expect(parameters.facetValues0).toEqual(['size-xl', 'size-l']);
    expect(parameters.facetValues1).toEqual(['material-cotton']);
  });

  it('reads an axis facet through the variants and a descriptive one directly', () => {
    const sql = buildSql({ facets: inputFacets });

    expect(sql).toContain('variant_attribute_values');
    expect(sql).toContain('product_descriptive_values');
    expect(sql).toContain('variant."deletedAt" IS NULL');
  });

  it('leaves a facet out of its own counts', () => {
    const sql = buildSql({ facets: inputFacets, exceptFacetKey: 'size' });

    expect(sql).not.toContain('variant_attribute_values');
    expect(sql).toContain('product_descriptive_values');
  });

  it('only filters on stock when inStock was actually requested', () => {
    expect(buildSql({ inStock: false })).toBe('');
    expect(buildSql({ inStock: true })).toContain('"totalStock" > 0');
  });

  it('treats a zero price bound as a real filter', () => {
    expect(buildSql({ minPrice: 0 })).toContain('>= :minPrice');
  });

  it('ignores an absent search', () => {
    expect(buildSql({ tsquery: null })).toBe('');
  });

  it('only ever names the store-published categories', () => {
    const sql = buildSql({ categorySlug: 'kitchen' });

    expect(sql).toContain('category."isPublished" = true');
    expect(sql).toContain('category."deletedAt" IS NULL');
  });
});
