import { DataSource } from 'typeorm';
import { Category } from '../../src/catalog/entities/category.entity';
import { slugify } from '../../src/site-builder/utils/slugify.util';
import { SeededStore } from './seed-stores';

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
): Promise<number> {
  const repository = dataSource.getRepository(Category);
  let created = 0;

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

    await repository.save(rows);
    created += rows.length;
  }

  return created;
}
