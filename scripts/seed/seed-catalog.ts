import { DataSource } from 'typeorm';
import {
  ATTRIBUTE_KEY_MAX_LENGTH,
  ATTRIBUTE_VALUE_SLUG_MAX_LENGTH,
} from '../../src/catalog/catalog.constants';
import { Category } from '../../src/catalog/entities/category.entity';
import { ProductAttribute } from '../../src/catalog/entities/product-attribute.entity';
import { ProductAttributeValue } from '../../src/catalog/entities/product-attribute-value.entity';
import { slugifyToken } from '../../src/catalog/utils/slugify-token.util';
import { slugify } from '../../src/site-builder/utils/slugify.util';
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
