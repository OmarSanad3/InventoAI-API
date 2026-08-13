import { DataSource, EntityManager } from 'typeorm';
import {
  ATTRIBUTE_KEY_MAX_LENGTH,
  ATTRIBUTE_VALUE_SLUG_MAX_LENGTH,
  PRODUCT_CATEGORIES_TABLE,
  PRODUCT_DESCRIPTIVE_VALUES_TABLE,
  PRODUCT_SLUG_MAX_LENGTH,
} from '../../src/catalog/catalog.constants';
import { Category } from '../../src/catalog/entities/category.entity';
import { Product } from '../../src/catalog/entities/product.entity';
import { ProductAttribute } from '../../src/catalog/entities/product-attribute.entity';
import { ProductAttributeValue } from '../../src/catalog/entities/product-attribute-value.entity';
import { ProductStatus } from '../../src/catalog/enums/product-status.enum';
import { ProductService } from '../../src/catalog/product.service';
import { slugifyToken } from '../../src/catalog/utils/slugify-token.util';
import { insertVariants } from '../../src/catalog/utils/variant-rows.util';
import { slugify } from '../../src/site-builder/utils/slugify.util';
import { SeedProduct } from './fixtures';
import { SeededStore } from './seed-stores';

/** One store's category, kept so the report can print its id. */
export interface SeededCategory {
  readonly storeSlug: string;
  readonly category: Category;
}

/**
 * Categories for every seeded store.
 *
 * Written straight through the repository rather than `CategoryService`,
 * because the service resolves the store from a JWT and there is no request
 * here. The trade-off is that the slug is derived, not de-duplicated — safe
 * only because the fixtures have no colliding names, and a duplicate would
 * surface immediately as a unique-index violation rather than silently.
 */
export async function seedCategories(
  dataSource: DataSource,
  stores: readonly SeededStore[],
): Promise<SeededCategory[]> {
  const repository = dataSource.getRepository(Category);
  const seeded: SeededCategory[] = [];

  for (const { store, definition } of stores) {
    const rows = definition.categories.map((category, index) =>
      repository.create({
        storeId: store.id,
        name: category.name,
        slug: slugify(category.name),
        description: category.description,
        position: index,
        isPublished: category.isPublished ?? true,
        isFeatured: category.isFeatured ?? false,
        imageUrl: null,
        imagePublicId: null,
      }),
    );

    for (const category of await repository.save(rows)) {
      seeded.push({ storeSlug: definition.slug, category });
    }
  }

  return seeded;
}

/** One store's attribute, with its values, ready to print for an API client. */
export interface SeededAttribute {
  readonly storeSlug: string;
  readonly attribute: ProductAttribute;
}

/**
 * Store-defined attributes and their controlled values.
 *
 * Written through the repository for the same reason categories are, and with
 * the same trade-off: keys and slugs are derived, not de-duplicated. The
 * fixtures have no colliding names within a store, and a collision would fail
 * loudly on the partial unique index rather than quietly.
 *
 * `slugifyToken`, not `slugify` — the latter is the store-name slugifier and
 * turns the size `S` into `my-store`.
 */
export async function seedAttributes(
  dataSource: DataSource,
  stores: readonly SeededStore[],
): Promise<SeededAttribute[]> {
  const repository = dataSource.getRepository(ProductAttribute);
  const seeded: SeededAttribute[] = [];

  for (const { store, definition } of stores) {
    for (const [index, fixture] of definition.attributes.entries()) {
      const attribute = repository.create({
        storeId: store.id,
        name: fixture.name,
        key:
          fixture.key ??
          slugifyToken({
            text: fixture.name,
            fallback: 'attribute',
            maxLength: ATTRIBUTE_KEY_MAX_LENGTH,
          }),
        isVariantAxis: fixture.isVariantAxis ?? false,
        isFilterable: fixture.isFilterable ?? true,
        showOnProductPage: fixture.showOnProductPage ?? true,
        displayStyle: fixture.displayStyle,
        position: index,
        values: fixture.values.map((value, valuePosition) =>
          buildValue(dataSource, store.id, value, valuePosition),
        ),
      });

      seeded.push({
        storeSlug: definition.slug,
        attribute: await repository.save(attribute),
      });
    }
  }

  return seeded;
}

/** One store's product, kept so the report can print its id. */
export interface SeededProduct {
  readonly storeSlug: string;
  readonly product: Product;
}

/**
 * The catalog itself: products, their variants, and the join rows that put them
 * in categories and give them their descriptive attributes.
 *
 * Written through the repository like the rest of the seed, with one deliberate
 * exception — the four derived columns go through
 * `ProductService.recalculateAggregates`, because that method is the catalog's
 * single writer of them and a seed that computed its own would be the first
 * place they could start lying.
 */
export async function seedProducts(
  dataSource: DataSource,
  productService: ProductService,
  stores: readonly SeededStore[],
  categories: readonly SeededCategory[],
  attributes: readonly SeededAttribute[],
): Promise<SeededProduct[]> {
  const seeded: SeededProduct[] = [];

  for (const { store, definition } of stores) {
    const categoryIds = buildCategoryIndex(categories, definition.slug);
    const valueIds = buildValueIndex(attributes, definition.slug);

    for (const [index, fixture] of definition.products.entries()) {
      const product = await dataSource.transaction(async (manager) =>
        writeProduct({
          manager,
          productService,
          storeId: store.id,
          fixture,
          position: index,
          categoryIds,
          valueIds,
        }),
      );
      seeded.push({ storeSlug: definition.slug, product });
    }
  }

  return seeded;
}

interface WriteProductOptions {
  readonly manager: EntityManager;
  readonly productService: ProductService;
  readonly storeId: string;
  readonly fixture: SeedProduct;
  readonly position: number;
  readonly categoryIds: ReadonlyMap<string, string>;
  readonly valueIds: ReadonlyMap<string, string>;
}

async function writeProduct({
  manager,
  productService,
  storeId,
  fixture,
  position,
  categoryIds,
  valueIds,
}: WriteProductOptions): Promise<Product> {
  const product = manager.create(Product, {
    storeId,
    title: fixture.title,
    slug:
      fixture.slug ??
      slugifyToken({
        text: fixture.title,
        fallback: 'product',
        maxLength: PRODUCT_SLUG_MAX_LENGTH,
      }),
    description: fixture.description ?? null,
    shortDescription: fixture.shortDescription ?? null,
    searchKeywords: fixture.searchKeywords ?? null,
    status: fixture.status ?? ProductStatus.Active,
    isFeatured: fixture.isFeatured ?? false,
    position,
  });
  await manager.save(product);

  await linkAll(
    manager,
    PRODUCT_CATEGORIES_TABLE,
    'categoryId',
    product.id,
    (fixture.categories ?? []).map((slug) => resolve(categoryIds, slug)),
  );
  await linkAll(
    manager,
    PRODUCT_DESCRIPTIVE_VALUES_TABLE,
    'attributeValueId',
    product.id,
    (fixture.attributeValues ?? []).map((token) => resolve(valueIds, token)),
  );

  await insertVariants({
    manager,
    productId: product.id,
    storeId,
    rows: fixture.variants.map((variant) => ({
      ...variant,
      attributeValueIds: (variant.options ?? []).map((token) =>
        resolve(valueIds, token),
      ),
    })),
  });
  await productService.recalculateAggregates(product.id, manager);

  return manager.findOneByOrFail(Product, { id: product.id });
}

/** A fixture naming something that does not exist is a typo, not a warning. */
function resolve(index: ReadonlyMap<string, string>, token: string): string {
  const id = index.get(token);
  if (!id) {
    throw new Error(`seed: "${token}" does not match anything in this store`);
  }
  return id;
}

function buildCategoryIndex(
  categories: readonly SeededCategory[],
  storeSlug: string,
): Map<string, string> {
  return new Map(
    categories
      .filter((entry) => entry.storeSlug === storeSlug)
      .map((entry) => [entry.category.slug, entry.category.id]),
  );
}

/** Keyed `attributeKey:valueSlug`, because a value slug is unique per attribute. */
function buildValueIndex(
  attributes: readonly SeededAttribute[],
  storeSlug: string,
): Map<string, string> {
  const index = new Map<string, string>();

  for (const { attribute } of attributes.filter(
    (entry) => entry.storeSlug === storeSlug,
  )) {
    for (const value of attribute.values) {
      index.set(`${attribute.key}:${value.slug}`, value.id);
    }
  }
  return index;
}

async function linkAll(
  manager: EntityManager,
  table: string,
  column: string,
  productId: string,
  ids: readonly string[],
): Promise<void> {
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

function buildValue(
  dataSource: DataSource,
  storeId: string,
  fixture: { readonly value: string; readonly swatchHex?: string },
  position: number,
): ProductAttributeValue {
  return dataSource.getRepository(ProductAttributeValue).create({
    storeId,
    value: fixture.value,
    slug: slugifyToken({
      text: fixture.value,
      fallback: 'value',
      maxLength: ATTRIBUTE_VALUE_SLUG_MAX_LENGTH,
    }),
    swatchHex: fixture.swatchHex ?? null,
    position,
  });
}
