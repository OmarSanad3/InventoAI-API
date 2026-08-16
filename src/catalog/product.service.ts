import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  FindOptionsRelations,
  In,
  Like,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ReorderDto } from '../common/dto/reorder.dto';
import { Store } from '../site-builder/entities/store.entity';
import { StoreService } from '../site-builder/store.service';
import {
  PRODUCT_CATEGORIES_TABLE,
  PRODUCT_DESCRIPTIVE_VALUES_TABLE,
  PRODUCT_SLUG_MAX_LENGTH,
  SEARCH_TEXT_CONFIG,
} from './catalog.constants';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';
import { ProductAttributeValue } from './entities/product-attribute-value.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { ProductSort } from './enums/product-sort.enum';
import { ProductStatus } from './enums/product-status.enum';
import { ProductAttributeService } from './product-attribute.service';
import { assertComparePrice } from './utils/compare-price.util';
import { buildSearchQuery } from './utils/search-query.util';
import { slugifyToken } from './utils/slugify-token.util';
import { buildUniqueSlug } from './utils/unique-slug.util';
import { getUniqueViolation } from './utils/unique-violation.util';
import { buildVariantLabel } from './utils/variant-label.util';
import { assertVariantMatrix, MatrixValue } from './utils/variant-matrix.util';
import { insertVariants } from './utils/variant-rows.util';

/**
 * One sellable shelf: a variant, what is on it, and enough of its product to
 * name it in a sentence. What `listStockLevels` returns for the Advisor.
 */
export interface StockLevel {
  variantId: string;
  productId: string;
  productTitle: string;
  productSlug: string;
  variantLabel: string | null;
  stockQuantity: number;
  lowStockThreshold: number;
  /** Minor units — what a unit of this is worth. */
  priceAmount: number;
}

/** Every relation the dashboard's full product view needs. */
const FULL_RELATIONS: FindOptionsRelations<Product> = {
  images: true,
  categories: true,
  attributeValues: { attribute: true },
  variants: { attributeValues: { attribute: true } },
};

/** Treats an empty edit as "clear this field" rather than "set it to blank". */
function toNullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Owns the `Product` row and the four aggregates denormalised onto it. Every
 * method resolves the caller's store first and scopes its query by that id, so
 * a product of another store is invisible rather than forbidden.
 */
@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(ProductVariant)
    private readonly variantRepository: Repository<ProductVariant>,
    private readonly productAttributeService: ProductAttributeService,
    private readonly storeService: StoreService,
  ) {}

  async create(user: JwtPayload, dto: CreateProductDto): Promise<Product> {
    const store = await this.storeService.resolveCallerStore(user);

    const categoryIds = await this.resolveCategoryIds(
      store.id,
      dto.categoryIds,
    );
    const descriptiveIds = await this.resolveDescriptiveValueIds(
      store.id,
      dto.attributeValueIds,
    );
    await this.assertVariantsAreValid(store.id, dto.variants);

    const candidate =
      dto.slug ??
      slugifyToken({
        text: dto.title,
        fallback: 'product',
        maxLength: PRODUCT_SLUG_MAX_LENGTH,
      });

    const productId = await this.insertProduct({
      store,
      dto,
      candidate,
      categoryIds,
      descriptiveIds,
    });
    return this.loadFull(store.id, productId);
  }

  /** The dashboard list — drafts and archived rows included, that is the point. */
  async list(
    user: JwtPayload,
    query: ProductQueryDto,
  ): Promise<[Product[], number]> {
    const store = await this.storeService.resolveCallerStore(user);
    const builder = this.buildDashboardQuery(store.id, query);

    const total = await builder.getCount();
    const rows = await builder
      .clone()
      .select('product.id', 'id')
      .orderBy(this.buildDashboardOrder(query), query.order)
      .addOrderBy('product.id', 'ASC')
      .offset(query.offset)
      .limit(query.limit)
      .getRawMany<{ id: string }>();

    const products = await this.loadListPage(rows.map((row) => row.id));
    return [products, total];
  }

  async getById(user: JwtPayload, id: string): Promise<Product> {
    const store = await this.storeService.resolveCallerStore(user);
    return this.loadFull(store.id, id);
  }

  async update(
    user: JwtPayload,
    id: string,
    dto: UpdateProductDto,
  ): Promise<Product> {
    const store = await this.storeService.resolveCallerStore(user);
    const product = await this.getScoped(store.id, id);

    this.applyEditableFields(product, dto);
    if (dto.slug !== undefined && dto.slug !== product.slug) {
      product.slug = await this.buildSlug(store.id, dto.slug, product.id);
    }

    const categoryIds = await this.resolveCategoryIds(
      store.id,
      dto.categoryIds,
    );
    const descriptiveIds = await this.resolveDescriptiveValueIds(
      store.id,
      dto.attributeValueIds,
    );

    await this.runUnique(async () => {
      await this.productRepository.manager.transaction(async (manager) => {
        await manager.save(product);
        if (categoryIds) {
          await this.replaceLinks(
            manager,
            PRODUCT_CATEGORIES_TABLE,
            'categoryId',
            product.id,
            categoryIds,
          );
        }
        if (descriptiveIds) {
          await this.replaceLinks(
            manager,
            PRODUCT_DESCRIPTIVE_VALUES_TABLE,
            'attributeValueId',
            product.id,
            descriptiveIds,
          );
        }
      });
    });

    return this.loadFull(store.id, product.id);
  }

  /**
   * Soft delete, variants with it — the rows stay as the join target for an
   * order's line item, whose snapshot renders the order correctly regardless.
   * Images are left on Cloudinary for the same reason categories' are.
   */
  async remove(user: JwtPayload, id: string): Promise<void> {
    const store = await this.storeService.resolveCallerStore(user);
    const product = await this.getScoped(store.id, id);

    await this.productRepository.manager.transaction(async (manager) => {
      await manager.softDelete(ProductVariant, { productId: product.id });
      await manager.softDelete(Product, { id: product.id });
    });
  }

  async reorder(user: JwtPayload, dto: ReorderDto): Promise<void> {
    const store = await this.storeService.resolveCallerStore(user);
    const ids = dto.items.map((item) => item.id);
    await this.assertIdsBelongToStore(store.id, ids);

    await this.productRepository.manager.transaction(async (manager) => {
      for (const item of dto.items) {
        await manager.update(
          Product,
          { id: item.id, storeId: store.id },
          { position: item.position },
        );
      }
    });
  }

  /**
   * **The only writer of `minPriceAmount`, `maxPriceAmount`, `totalStock` and
   * `variantCount`.** Every path that touches a variant — create, update,
   * delete, and the order module's stock decrement and restore — calls this
   * inside the same transaction. Nowhere else may assign those four columns;
   * scattered arithmetic is exactly how denormalised aggregates start lying.
   */
  async recalculateAggregates(
    productId: string,
    manager: EntityManager,
  ): Promise<void> {
    const row = await manager
      .createQueryBuilder(ProductVariant, 'variant')
      .select('COALESCE(MIN(variant.priceAmount), 0)', 'minPrice')
      .addSelect('COALESCE(MAX(variant.priceAmount), 0)', 'maxPrice')
      .addSelect('COALESCE(SUM(variant.stockQuantity), 0)', 'totalStock')
      .addSelect('COUNT(variant.id)', 'variantCount')
      .where('variant.productId = :productId', { productId })
      .getRawOne<Record<string, string | number>>();

    await manager.update(
      Product,
      { id: productId },
      {
        minPriceAmount: Number(row?.minPrice ?? 0),
        maxPriceAmount: Number(row?.maxPrice ?? 0),
        totalStock: Number(row?.totalStock ?? 0),
        variantCount: Number(row?.variantCount ?? 0),
      },
    );
  }

  /**
   * Every sellable variant of a store, with the stock on its shelf.
   *
   * Written for the Daily AI Advisor, and it lives here rather than there for
   * the same reason `recalculateAggregates` is public: the rule about which
   * products are *advisable* is a catalog rule. A `draft` product is not stock
   * advice — nobody can buy it — and an `archived` one is stock the owner has
   * already decided to stop selling. Both would otherwise be a query the
   * Advisor grew of its own, one visibility rule away from disagreeing with the
   * storefront.
   */
  async listStockLevels(storeId: string): Promise<StockLevel[]> {
    const variants = await this.variantRepository.find({
      where: {
        storeId,
        product: { storeId, status: ProductStatus.Active },
      },
      relations: {
        product: true,
        attributeValues: { attribute: true },
      },
      order: { position: 'ASC' },
    });

    return variants.map((variant) => ({
      variantId: variant.id,
      productId: variant.productId,
      productTitle: variant.product.title,
      productSlug: variant.product.slug,
      variantLabel: buildVariantLabel(variant),
      stockQuantity: variant.stockQuantity,
      lowStockThreshold: variant.lowStockThreshold,
      priceAmount: variant.priceAmount,
    }));
  }

  /** A product of another store must look missing, never forbidden. */
  async getScoped(storeId: string, id: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id, storeId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  /** The whole object every dashboard write returns. */
  async loadFull(storeId: string, id: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id, storeId },
      relations: FULL_RELATIONS,
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

  /**
   * Resolves the values a set of variants is keyed by and checks the matrix as
   * a whole. Shared with `ProductVariantService`, which validates the product's
   * existing variants together with the ones being added.
   */
  async assertVariantsAreValid(
    storeId: string,
    variants: readonly {
      attributeValueIds?: readonly string[];
      priceAmount?: number;
      compareAtAmount?: number | null;
    }[],
  ): Promise<void> {
    const valueIds = variants.flatMap((variant) => [
      ...(variant.attributeValueIds ?? []),
    ]);
    const valuesById = await this.loadMatrixValues(storeId, valueIds);

    assertVariantMatrix({ variants, valuesById });
    for (const variant of variants) {
      if (variant.priceAmount !== undefined) {
        assertComparePrice(
          variant.priceAmount,
          variant.compareAtAmount ?? null,
        );
      }
    }
  }

  /** Turns the store's own values into what the matrix rules need. */
  async loadMatrixValues(
    storeId: string,
    valueIds: readonly string[],
  ): Promise<Map<string, MatrixValue>> {
    const values = await this.productAttributeService.loadValuesByIds(
      storeId,
      valueIds,
    );
    return new Map(
      [...values].map(([id, value]) => [
        id,
        {
          attributeId: value.attributeId,
          attributeName: value.attribute?.name ?? '',
          isVariantAxis: value.attribute?.isVariantAxis ?? false,
          label: value.value,
        },
      ]),
    );
  }

  /**
   * Retries once on a slug collision and translates the catalog's other two
   * unique indexes into the 409 the owner can act on. A `23505` aborts the whole
   * transaction, so the retry re-runs it rather than patching one row.
   */
  async runUnique<T>(
    write: () => Promise<T>,
    onSlugRetry?: () => void,
  ): Promise<T> {
    try {
      return await write();
    } catch (err) {
      const constraint = getUniqueViolation(err);
      if (constraint === null) {
        throw err;
      }
      if (constraint.includes('sku')) {
        throw new ConflictException('That SKU is already used in your store');
      }
      if (constraint.includes('options')) {
        throw new ConflictException(
          'That combination of attributes already exists on this product',
        );
      }
      // Only creation can pick a different slug and try again. An update loses
      // the race with a concurrent rename, and that is a 409 the owner can act
      // on rather than the raw driver error a rethrow would surface as a 500.
      if (!onSlugRetry) {
        throw new ConflictException('That slug is already taken in your store');
      }
      onSlugRetry();
      return write();
    }
  }

  private async insertProduct({
    store,
    dto,
    candidate,
    categoryIds,
    descriptiveIds,
  }: {
    store: Store;
    dto: CreateProductDto;
    candidate: string;
    categoryIds: string[] | undefined;
    descriptiveIds: string[] | undefined;
  }): Promise<string> {
    const product = this.productRepository.create({
      storeId: store.id,
      title: dto.title.trim(),
      slug: await this.buildSlug(store.id, candidate),
      description: dto.description ? toNullableText(dto.description) : null,
      shortDescription: dto.shortDescription
        ? toNullableText(dto.shortDescription)
        : null,
      searchKeywords: dto.searchKeywords
        ? toNullableText(dto.searchKeywords)
        : null,
      status: dto.status,
      isFeatured: dto.isFeatured ?? false,
      weightGrams: dto.weightGrams ?? null,
      position: await this.findNextPosition(store.id),
    });

    return this.runUnique(
      async () => {
        await this.productRepository.manager.transaction(async (manager) => {
          await manager.save(product);
          await this.replaceLinks(
            manager,
            PRODUCT_CATEGORIES_TABLE,
            'categoryId',
            product.id,
            categoryIds ?? [],
          );
          await this.replaceLinks(
            manager,
            PRODUCT_DESCRIPTIVE_VALUES_TABLE,
            'attributeValueId',
            product.id,
            descriptiveIds ?? [],
          );
          await insertVariants({
            manager,
            productId: product.id,
            storeId: store.id,
            rows: dto.variants,
          });
          await this.recalculateAggregates(product.id, manager);
        });
        return product.id;
      },
      () => {
        product.slug = `${candidate}-${Date.now().toString(36)}`;
      },
    );
  }

  private applyEditableFields(product: Product, dto: UpdateProductDto): void {
    if (dto.title !== undefined) {
      product.title = dto.title.trim();
    }
    if (dto.description !== undefined) {
      product.description = toNullableText(dto.description);
    }
    if (dto.shortDescription !== undefined) {
      product.shortDescription = toNullableText(dto.shortDescription);
    }
    if (dto.searchKeywords !== undefined) {
      product.searchKeywords = toNullableText(dto.searchKeywords);
    }
    if (dto.status !== undefined) {
      product.status = dto.status;
    }
    if (dto.isFeatured !== undefined) {
      product.isFeatured = dto.isFeatured;
    }
    if (dto.weightGrams !== undefined) {
      product.weightGrams = dto.weightGrams;
    }
  }

  private buildDashboardQuery(
    storeId: string,
    query: ProductQueryDto,
  ): SelectQueryBuilder<Product> {
    const builder = this.productRepository
      .createQueryBuilder('product')
      .where('product.storeId = :storeId', { storeId });

    if (query.status) {
      builder.andWhere('product.status = :status', { status: query.status });
    }
    if (query.isFeatured !== undefined) {
      builder.andWhere('product.isFeatured = :isFeatured', {
        isFeatured: query.isFeatured,
      });
    }
    if (query.categoryId) {
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM ${PRODUCT_CATEGORIES_TABLE} link
          WHERE link."productId" = product.id AND link."categoryId" = :categoryId
        )`,
        { categoryId: query.categoryId },
      );
    }
    if (query.lowStock) {
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM product_variants variant
          WHERE variant."productId" = product.id
            AND variant."deletedAt" IS NULL
            AND variant."stockQuantity" <= variant."lowStockThreshold"
        )`,
      );
    }
    this.applyDashboardSearch(builder, query.search);

    return builder;
  }

  /**
   * An owner looking for a row they know exists: the same stemming the
   * storefront uses, **or** a prefix match on a variant SKU. SKUs are codes, not
   * prose — stemming `TSHIRT-RED-XL` is meaningless and tokenising it is worse.
   */
  private applyDashboardSearch(
    builder: SelectQueryBuilder<Product>,
    search: string | undefined,
  ): void {
    const query = buildSearchQuery(search);
    if (!query) {
      return;
    }

    builder.andWhere(
      `(product."searchVector" @@ to_tsquery('${SEARCH_TEXT_CONFIG}', :tsquery)
        OR EXISTS (
          SELECT 1 FROM product_variants variant
          WHERE variant."productId" = product.id
            AND variant."deletedAt" IS NULL
            AND variant.sku ILIKE :skuPrefix
        ))`,
      { tsquery: query.tsquery, skuPrefix: `${query.term}%` },
    );
  }

  private buildDashboardOrder(query: ProductQueryDto): string {
    const columns: Record<ProductSort, string> = {
      [ProductSort.CreatedAt]: 'product.createdAt',
      [ProductSort.Title]: 'product.title',
      [ProductSort.MinPrice]: 'product.minPriceAmount',
      [ProductSort.TotalStock]: 'product.totalStock',
    };
    return columns[query.sort];
  }

  /**
   * Loads a page's rows with their relations, in the order the id query
   * returned them. Two queries rather than one join, because a `LIMIT` over a
   * joined result counts join rows, not products.
   */
  private async loadListPage(ids: string[]): Promise<Product[]> {
    if (ids.length === 0) {
      return [];
    }

    const products = await this.productRepository.find({
      where: { id: In(ids) },
      relations: { images: true, categories: true },
      order: { images: { position: 'ASC' } },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    return ids
      .map((id) => byId.get(id))
      .filter((product): product is Product => product !== undefined);
  }

  /** Replaces a join table's rows for one product, inside the caller's tx. */
  private async replaceLinks(
    manager: EntityManager,
    table: string,
    column: string,
    productId: string,
    ids: readonly string[],
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .delete()
      .from(table)
      .where('"productId" = :productId', { productId })
      .execute();

    if (ids.length === 0) {
      return;
    }
    await manager
      .createQueryBuilder()
      .insert()
      .into(table, ['productId', column])
      .values(ids.map((id) => ({ productId, [column]: id })))
      .execute();
  }

  /** A foreign id is a 400 naming the field, never a silent drop. */
  private async resolveCategoryIds(
    storeId: string,
    ids: string[] | undefined,
  ): Promise<string[] | undefined> {
    if (ids === undefined) {
      return undefined;
    }
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      return [];
    }

    const found = await this.categoryRepository.find({
      where: { storeId, id: In(unique) },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new BadRequestException(
        'categoryIds: every category must belong to your store',
      );
    }
    return unique;
  }

  /**
   * Product-level values are **descriptive** only. Putting Size here instead of
   * on the variant is the likeliest client mistake there is, so it is a 400
   * naming the attribute rather than a quiet accept.
   */
  private async resolveDescriptiveValueIds(
    storeId: string,
    ids: string[] | undefined,
  ): Promise<string[] | undefined> {
    if (ids === undefined) {
      return undefined;
    }
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      return [];
    }

    const values = await this.productAttributeService.loadValuesByIds(
      storeId,
      unique,
    );
    for (const id of unique) {
      this.assertDescriptive(values.get(id), id);
    }
    return unique;
  }

  private assertDescriptive(
    value: ProductAttributeValue | undefined,
    id: string,
  ): void {
    if (!value) {
      throw new BadRequestException(
        `attributeValueIds: "${id}" is not a value of your store`,
      );
    }
    if (value.attribute?.isVariantAxis) {
      throw new BadRequestException(
        `attributeValueIds: "${value.attribute.name}" defines variants, so "${value.value}" belongs on a variant rather than the product`,
      );
    }
  }

  private async assertIdsBelongToStore(
    storeId: string,
    ids: string[],
  ): Promise<void> {
    const found = await this.productRepository.find({
      where: { storeId, id: In(ids) },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new BadRequestException(
        'Every product must belong to your store and appear once',
      );
    }
  }

  /** Resolves the candidate against the slugs this store already uses. */
  private async buildSlug(
    storeId: string,
    candidate: string,
    exceptProductId?: string,
  ): Promise<string> {
    const rows = await this.productRepository.find({
      where: [
        { storeId, slug: candidate },
        { storeId, slug: Like(`${candidate}-%`) },
      ],
      select: { id: true, slug: true },
    });

    const taken = new Set(
      rows.filter((row) => row.id !== exceptProductId).map((row) => row.slug),
    );
    return buildUniqueSlug({ candidate, taken });
  }

  private async findNextPosition(storeId: string): Promise<number> {
    const row = await this.productRepository
      .createQueryBuilder('product')
      .select('MAX(product.position)', 'max')
      .where('product.storeId = :storeId', { storeId })
      .getRawOne<{ max: number | null }>();
    return Number(row?.max ?? -1) + 1;
  }
}
