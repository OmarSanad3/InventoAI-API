import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  FindOptionsRelations,
  In,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { StoreService } from '../site-builder/store.service';
import {
  MAX_FEATURED_PRODUCTS,
  SEARCH_RANK_NORMALIZATION,
  SEARCH_SUGGEST_LIMIT,
  SEARCH_TEXT_CONFIG,
  SEARCH_WORD_SIMILARITY_THRESHOLD,
} from './catalog.constants';
import { PublicProductQueryDto } from './dto/public-product-query.dto';
import { SearchMode } from './dto/product-search-response.dto';
import { Product } from './entities/product.entity';
import { ProductStatus } from './enums/product-status.enum';
import { PublicProductSort } from './enums/product-sort.enum';
import { ProductAttributeService } from './product-attribute.service';
import {
  buildPublicProductPredicates,
  PublicProductFilters,
} from './utils/product-predicates.util';
import { buildSearchQuery, SearchQuery } from './utils/search-query.util';

/** Everything a storefront card renders from, including its swatch previews. */
const CARD_RELATIONS: FindOptionsRelations<Product> = {
  images: true,
  categories: true,
  variants: { attributeValues: { attribute: true } },
};

const DETAIL_RELATIONS: FindOptionsRelations<Product> = {
  images: true,
  categories: true,
  attributeValues: { attribute: true },
  variants: { attributeValues: { attribute: true } },
};

export interface ProductSearchResult {
  readonly products: Product[];
  readonly total: number;
  readonly mode: SearchMode | null;
  readonly didYouMean: string | null;
}

/**
 * The storefront half of the catalog: browsing, filtering and searching a live
 * store's active products.
 *
 * Every query here is hard-filtered by `store.status = live`,
 * `product.status = active` and `deletedAt IS NULL`. A draft product must be
 * unreachable by direct slug, not merely absent from a list.
 */
@Injectable()
export class PublicProductService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly productAttributeService: ProductAttributeService,
    private readonly storeService: StoreService,
  ) {}

  /**
   * Ranked full-text first; the trigram pass only when it found nothing. The
   * fuzzy query is one extra round trip on a search that already failed, so the
   * common path pays nothing for typo tolerance.
   */
  async search(
    slug: string,
    query: PublicProductQueryDto,
  ): Promise<ProductSearchResult> {
    const storeId = await this.resolveStoreId(slug);
    const search = buildSearchQuery(query.search);
    const filters = await this.buildFilters(storeId, query, search);

    const exact = await this.findPage(storeId, query, filters, search);
    if (!search) {
      return { ...exact, mode: null, didYouMean: null };
    }
    if (exact.total > 0) {
      return { ...exact, mode: 'exact', didYouMean: null };
    }

    const fuzzy = await this.findFuzzyPage(storeId, query, filters, search);
    return {
      ...fuzzy,
      mode: 'fuzzy',
      didYouMean: fuzzy.products[0]?.title ?? null,
    };
  }

  /**
   * The autocomplete dropdown. No fuzzy fallback: it fires on every debounced
   * keystroke, and an empty dropdown mid-word is the correct, quiet answer.
   */
  async suggest(
    slug: string,
    rawSearch: string | undefined,
  ): Promise<Product[]> {
    const storeId = await this.resolveStoreId(slug);
    const search = buildSearchQuery(rawSearch);
    if (!search) {
      return [];
    }

    const rows = await this.buildBaseQuery(storeId)
      .select('product.id', 'id')
      .andWhere(
        `product."searchVector" @@ to_tsquery('${SEARCH_TEXT_CONFIG}', :tsquery)`,
        { tsquery: search.tsquery },
      )
      .orderBy(this.buildRankExpression(), 'DESC')
      .addOrderBy('product.createdAt', 'DESC')
      .limit(SEARCH_SUGGEST_LIMIT)
      .getRawMany<{ id: string }>();

    return this.loadPage(
      rows.map((row) => row.id),
      { images: true },
    );
  }

  /**
   * Cards for a set of ids, in the order given.
   *
   * The storefront predicates are applied **again** here on purpose: the caller
   * is the chatbot's knowledge base, whose index may be a minute behind the
   * catalog. A product archived since it was indexed simply drops out, so a
   * stale index can never put a hidden product in front of a shopper.
   */
  async loadCardsByIds(
    storeId: string,
    ids: readonly string[],
  ): Promise<Product[]> {
    if (ids.length === 0) {
      return [];
    }

    const products = await this.productRepository.find({
      where: { id: In([...ids]), storeId, status: ProductStatus.Active },
      relations: CARD_RELATIONS,
      order: { images: { position: 'ASC' } },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    return ids
      .map((id) => byId.get(id))
      .filter((product): product is Product => product !== undefined);
  }

  async getBySlug(slug: string, productSlug: string): Promise<Product> {
    const storeId = await this.resolveStoreId(slug);
    const product = await this.productRepository.findOne({
      where: { storeId, slug: productSlug, status: ProductStatus.Active },
      relations: DETAIL_RELATIONS,
      order: {
        images: { position: 'ASC' },
        variants: { position: 'ASC', createdAt: 'ASC' },
      },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  /** The landing page's featured strip, capped so it cannot grow unbounded. */
  async listFeatured(storeId: string): Promise<Product[]> {
    return this.productRepository.find({
      where: { storeId, status: ProductStatus.Active, isFeatured: true },
      relations: CARD_RELATIONS,
      order: {
        position: 'ASC',
        createdAt: 'DESC',
        images: { position: 'ASC' },
      },
      take: MAX_FEATURED_PRODUCTS,
    });
  }

  /** Shared with the filters endpoint, whose counts use the same predicates. */
  async buildFilters(
    storeId: string,
    query: PublicProductQueryDto,
    search: SearchQuery | null,
  ): Promise<PublicProductFilters> {
    return {
      categorySlug: query.category,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      inStock: query.inStock,
      tsquery: search?.tsquery ?? null,
      facets: await this.productAttributeService.resolveFacets(
        storeId,
        query.attributes,
      ),
    };
  }

  async resolveStoreId(slug: string): Promise<string> {
    const { store } = await this.storeService.resolvePublicStore(slug);
    return store.id;
  }

  /** The mandatory half of every storefront query — never optional, never skipped. */
  buildBaseQuery(storeId: string): SelectQueryBuilder<Product> {
    return this.productRepository
      .createQueryBuilder('product')
      .where('product.storeId = :storeId', { storeId })
      .andWhere('product.status = :status', { status: ProductStatus.Active });
  }

  applyPredicates(
    builder: SelectQueryBuilder<Product>,
    filters: PublicProductFilters,
  ): SelectQueryBuilder<Product> {
    for (const predicate of buildPublicProductPredicates('product', filters)) {
      builder.andWhere(predicate.sql, predicate.parameters);
    }
    return builder;
  }

  private async findPage(
    storeId: string,
    query: PublicProductQueryDto,
    filters: PublicProductFilters,
    search: SearchQuery | null,
  ): Promise<{ products: Product[]; total: number }> {
    const builder = this.applyPredicates(this.buildBaseQuery(storeId), filters);
    const total = await builder.getCount();

    const rows = await this.applySort(
      builder.clone().select('product.id', 'id'),
      query,
      search,
    )
      .offset(query.offset)
      .limit(query.limit)
      .getRawMany<{ id: string }>();

    return { products: await this.loadPage(rows.map((row) => row.id)), total };
  }

  /**
   * The trigram pass. `SET LOCAL` pins the threshold for this transaction, which
   * both keeps the behaviour off a server-level GUC a managed host might set
   * differently *and* lets `<%` use the trigram GIN index.
   *
   * `word_similarity` / `<%`, never `similarity` / `%`: the latter compares the
   * query against the *whole* title, so a long title drowns a short query —
   * measured at `0.109` against the `0.750` the former scores on the same row.
   * Note that the argument order is reversed between the two.
   */
  private async findFuzzyPage(
    storeId: string,
    query: PublicProductQueryDto,
    filters: PublicProductFilters,
    search: SearchQuery,
  ): Promise<{ products: Product[]; total: number }> {
    return this.productRepository.manager.transaction(async (manager) => {
      await manager.query(
        `SET LOCAL pg_trgm.word_similarity_threshold = ${SEARCH_WORD_SIMILARITY_THRESHOLD}`,
      );

      const builder = this.applyPredicates(
        this.buildFuzzyBaseQuery(manager, storeId),
        { ...filters, tsquery: null },
      ).setParameter('term', search.term);

      const total = await builder.getCount();
      const rows = await builder
        .clone()
        .select('product.id', 'id')
        .orderBy('word_similarity(:term, product."title")', 'DESC')
        .addOrderBy('product.createdAt', 'DESC')
        .offset(query.offset)
        .limit(query.limit)
        .getRawMany<{ id: string }>();

      return {
        products: await this.loadPage(rows.map((row) => row.id)),
        total,
      };
    });
  }

  private buildFuzzyBaseQuery(
    manager: EntityManager,
    storeId: string,
  ): SelectQueryBuilder<Product> {
    return manager
      .createQueryBuilder(Product, 'product')
      .where('product.storeId = :storeId', { storeId })
      .andWhere('product.status = :status', { status: ProductStatus.Active })
      .andWhere(':term <% product."title"');
  }

  /**
   * `relevance` when a search is present and no sort was picked; `newest`
   * otherwise. `sort=relevance` with no search degrades to `newest` rather than
   * 400 — search URLs get shared, and clearing the box must not land the shopper
   * on an error page.
   */
  private applySort(
    builder: SelectQueryBuilder<Product>,
    query: PublicProductQueryDto,
    search: SearchQuery | null,
  ): SelectQueryBuilder<Product> {
    const requested =
      query.sort ??
      (search ? PublicProductSort.Relevance : PublicProductSort.Newest);
    const sort =
      requested === PublicProductSort.Relevance && !search
        ? PublicProductSort.Newest
        : requested;

    switch (sort) {
      case PublicProductSort.Relevance:
        builder.orderBy(this.buildRankExpression(), 'DESC');
        break;
      case PublicProductSort.PriceAsc:
        builder.orderBy('product.minPriceAmount', 'ASC');
        break;
      case PublicProductSort.PriceDesc:
        builder.orderBy('product.minPriceAmount', 'DESC');
        break;
      case PublicProductSort.Title:
        builder.orderBy('product.title', 'ASC');
        break;
      default:
        builder.orderBy('product.createdAt', 'DESC');
    }

    // A stable tie-break, so equal scores do not shuffle between pages.
    return builder
      .addOrderBy('product.createdAt', 'DESC')
      .addOrderBy('product.id', 'ASC');
  }

  /**
   * Normalisation flag 32 divides by `rank + 1`, so the score lands in `0..1`
   * and stays comparable across queries.
   */
  private buildRankExpression(): string {
    return `ts_rank_cd(product."searchVector", to_tsquery('${SEARCH_TEXT_CONFIG}', :tsquery), ${SEARCH_RANK_NORMALIZATION})`;
  }

  /** Loads a page's rows with their relations, in the order the ids came back. */
  private async loadPage(
    ids: string[],
    relations: FindOptionsRelations<Product> = CARD_RELATIONS,
  ): Promise<Product[]> {
    if (ids.length === 0) {
      return [];
    }

    const products = await this.productRepository.find({
      where: { id: In(ids) },
      relations,
      order: { images: { position: 'ASC' } },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    return ids
      .map((id) => byId.get(id))
      .filter((product): product is Product => product !== undefined);
  }
}
