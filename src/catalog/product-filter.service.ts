import { Injectable } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';
import {
  PRODUCT_CATEGORIES_TABLE,
  PRODUCT_DESCRIPTIVE_VALUES_TABLE,
  VARIANT_ATTRIBUTE_VALUES_TABLE,
} from './catalog.constants';
import { PublicProductQueryDto } from './dto/public-product-query.dto';
import {
  FilterAttributeDto,
  FilterCategoryDto,
  FilterPriceRangeDto,
  StoreFiltersDto,
} from './dto/store-filters.dto';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';
import { ProductAttribute } from './entities/product-attribute.entity';
import { ProductAttributeService } from './product-attribute.service';
import { PublicProductService } from './public-product.service';
import { PublicProductFilters } from './utils/product-predicates.util';
import { buildSearchQuery } from './utils/search-query.util';

interface CountRow {
  readonly key: string;
  readonly count: string;
}

/**
 * Builds `GET /site/:slug/filters` — what the storefront sidebar renders itself
 * from. It takes the **same** query parameters as the product listing, because
 * the counts have to reflect the filters already applied.
 *
 * One count query per filterable attribute, each with the *other* facets'
 * predicates applied. With at most 20 attributes per store and typically three
 * or four filterable, that is a handful of indexed counts; if it ever profiles
 * badly the upgrade is a single grouped query over the join tables.
 */
@Injectable()
export class ProductFilterService {
  constructor(
    private readonly publicProductService: PublicProductService,
    private readonly productAttributeService: ProductAttributeService,
  ) {}

  async build(
    slug: string,
    query: PublicProductQueryDto,
  ): Promise<StoreFiltersDto> {
    const storeId = await this.publicProductService.resolveStoreId(slug);
    const filters = await this.publicProductService.buildFilters(
      storeId,
      query,
      buildSearchQuery(query.search),
    );
    const attributes =
      await this.productAttributeService.listFilterable(storeId);

    const dto = new StoreFiltersDto();
    dto.price = await this.countPriceRange(storeId, filters);
    dto.categories = await this.countCategories(storeId, filters);
    dto.attributes = await Promise.all(
      attributes.map((attribute) =>
        this.countAttribute(storeId, filters, attribute),
      ),
    );
    return dto;
  }

  /** The slider's bounds ignore the price filter itself, so it can be widened. */
  private async countPriceRange(
    storeId: string,
    filters: PublicProductFilters,
  ): Promise<FilterPriceRangeDto> {
    const row = await this.buildQuery(storeId, {
      ...filters,
      minPrice: undefined,
      maxPrice: undefined,
    })
      .select('COALESCE(MIN(product.minPriceAmount), 0)', 'min')
      .addSelect('COALESCE(MAX(product.maxPriceAmount), 0)', 'max')
      .getRawOne<{ min: string; max: string }>();

    const range = new FilterPriceRangeDto();
    range.min = Number(row?.min ?? 0);
    range.max = Number(row?.max ?? 0);
    return range;
  }

  private async countCategories(
    storeId: string,
    filters: PublicProductFilters,
  ): Promise<FilterCategoryDto[]> {
    const rows = await this.buildQuery(storeId, {
      ...filters,
      categorySlug: undefined,
    })
      .innerJoin(
        PRODUCT_CATEGORIES_TABLE,
        'link',
        'link."productId" = product.id',
      )
      .innerJoin(
        Category,
        'category',
        'category.id = link."categoryId" AND category."isPublished" = true',
      )
      .select('category.slug', 'slug')
      .addSelect('category.name', 'name')
      .addSelect('COUNT(DISTINCT product.id)', 'count')
      .groupBy('category.slug')
      .addGroupBy('category.name')
      .addGroupBy('category.position')
      .orderBy('category.position', 'ASC')
      .getRawMany<{ slug: string; name: string; count: string }>();

    return rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      count: Number(row.count),
    }));
  }

  /**
   * A facet's own selection is excluded from its own counts: having picked Red,
   * the shopper must still see how many Blue items there are, or every other
   * colour reads `0` and they cannot switch. Every *other* facet does apply —
   * which is exactly why this cannot be one query.
   */
  private async countAttribute(
    storeId: string,
    filters: PublicProductFilters,
    attribute: ProductAttribute,
  ): Promise<FilterAttributeDto> {
    const valueIds = attribute.values.map((value) => value.id);
    const counts = await this.countValues(
      storeId,
      filters,
      attribute,
      valueIds,
    );

    return {
      key: attribute.key,
      name: attribute.name,
      displayStyle: attribute.displayStyle,
      isVariantAxis: attribute.isVariantAxis,
      // A value with a count of 0 is returned, not omitted, and the frontend
      // renders it disabled — options that vanish as you click feel broken.
      values: attribute.values.map((value) => ({
        slug: value.slug,
        value: value.value,
        swatchHex: value.swatchHex,
        count: counts.get(value.id) ?? 0,
      })),
    };
  }

  private async countValues(
    storeId: string,
    filters: PublicProductFilters,
    attribute: ProductAttribute,
    valueIds: string[],
  ): Promise<Map<string, number>> {
    if (valueIds.length === 0) {
      return new Map();
    }

    const builder = this.buildQuery(storeId, {
      ...filters,
      exceptFacetKey: attribute.key,
    });

    if (attribute.isVariantAxis) {
      builder
        .innerJoin(
          'product_variants',
          'variant',
          'variant."productId" = product.id AND variant."deletedAt" IS NULL',
        )
        .innerJoin(
          VARIANT_ATTRIBUTE_VALUES_TABLE,
          'link',
          'link."variantId" = variant.id',
        );
    } else {
      builder.innerJoin(
        PRODUCT_DESCRIPTIVE_VALUES_TABLE,
        'link',
        'link."productId" = product.id',
      );
    }

    const rows = await builder
      .andWhere('link."attributeValueId" IN (:...valueIds)', { valueIds })
      .select('link."attributeValueId"', 'key')
      .addSelect('COUNT(DISTINCT product.id)', 'count')
      .groupBy('link."attributeValueId"')
      .getRawMany<CountRow>();

    return new Map(rows.map((row) => [row.key, Number(row.count)]));
  }

  private buildQuery(
    storeId: string,
    filters: PublicProductFilters,
  ): SelectQueryBuilder<Product> {
    return this.publicProductService.applyPredicates(
      this.publicProductService.buildBaseQuery(storeId),
      filters,
    );
  }
}
