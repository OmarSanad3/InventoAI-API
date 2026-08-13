import { EntityManager } from 'typeorm';
import { VARIANT_ATTRIBUTE_VALUES_TABLE } from '../catalog.constants';
import { ProductVariant } from '../entities/product-variant.entity';
import { buildOptionsKey } from './options-key.util';

/** The part of a variant a caller supplies; everything else is derived. */
export interface VariantRowInput {
  readonly sku?: string | null;
  readonly priceAmount: number;
  readonly compareAtAmount?: number | null;
  readonly stockQuantity?: number;
  readonly lowStockThreshold?: number;
  readonly attributeValueIds?: readonly string[];
}

export interface InsertVariantsOptions {
  readonly manager: EntityManager;
  readonly productId: string;
  readonly storeId: string;
  readonly rows: readonly VariantRowInput[];
  /** Where to continue the picker's order from. */
  readonly startPosition?: number;
}

/**
 * Writes variants and the join rows that define them, in the caller's
 * transaction. Shared by product creation, the single-variant route and the
 * matrix generator so all three derive `optionsKey` and `isDefault` the same
 * way — the alternative is three places that can disagree about what a default
 * variant is.
 */
export async function insertVariants({
  manager,
  productId,
  storeId,
  rows,
  startPosition = 0,
}: InsertVariantsOptions): Promise<ProductVariant[]> {
  const isSimpleProduct =
    rows.length === 1 &&
    startPosition === 0 &&
    (rows[0].attributeValueIds ?? []).length === 0;

  const variants = rows.map((row, index) =>
    manager.create(ProductVariant, {
      productId,
      storeId,
      sku: row.sku ?? null,
      priceAmount: row.priceAmount,
      compareAtAmount: row.compareAtAmount ?? null,
      stockQuantity: row.stockQuantity ?? 0,
      lowStockThreshold: row.lowStockThreshold ?? 0,
      optionsKey: buildOptionsKey(row.attributeValueIds),
      isDefault: isSimpleProduct,
      position: startPosition + index,
    }),
  );

  const saved = await manager.save(variants);
  await insertVariantLinks(manager, saved, rows);
  return saved;
}

/** Replaces the values that define one variant, join rows and key together. */
export async function replaceVariantOptions(
  manager: EntityManager,
  variant: ProductVariant,
  attributeValueIds: readonly string[],
): Promise<void> {
  await manager
    .createQueryBuilder()
    .delete()
    .from(VARIANT_ATTRIBUTE_VALUES_TABLE)
    .where('"variantId" = :variantId', { variantId: variant.id })
    .execute();

  variant.optionsKey = buildOptionsKey(attributeValueIds);
  await insertVariantLinks(manager, [variant], [{ attributeValueIds }]);
}

async function insertVariantLinks(
  manager: EntityManager,
  variants: readonly ProductVariant[],
  rows: readonly { readonly attributeValueIds?: readonly string[] }[],
): Promise<void> {
  const links = variants.flatMap((variant, index) =>
    (rows[index].attributeValueIds ?? []).map((attributeValueId) => ({
      variantId: variant.id,
      attributeValueId,
    })),
  );
  if (links.length === 0) {
    return;
  }

  await manager
    .createQueryBuilder()
    .insert()
    .into(VARIANT_ATTRIBUTE_VALUES_TABLE, ['variantId', 'attributeValueId'])
    .values(links)
    .execute();
}
