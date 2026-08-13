import { buildUniqueSlug } from './unique-slug.util';

/** A category or attribute the store already has, as the planner sees it. */
export interface ExistingCatalogEntry {
  readonly name: string;
  /** The `Category.slug` or the `ProductAttribute.key`. */
  readonly slug: string;
}

export interface CatalogEntryIdentity {
  readonly name: string;
  /** The slug or key this entry wants, already slugified. */
  readonly candidate: string;
  /**
   * True when the candidate is the generic fallback (`category`, `attribute`)
   * because the name has no Latin characters. A fallback identifies nothing, so
   * the planner must not read a collision with it as "already applied".
   */
  readonly isFallbackCandidate: boolean;
}

export interface PlannedCatalogEntry<T> {
  readonly entry: T;
  readonly slug: string;
}

export interface CatalogWritePlan<T> {
  readonly create: readonly PlannedCatalogEntry<T>[];
  /** The slug or key of every entry the store already had. */
  readonly skipped: readonly string[];
}

/** What one service wrote for its half of an apply. */
export interface CatalogBatchResult {
  readonly created: number;
  /** The slug or key of every entry the store already had. */
  readonly skipped: string[];
}

export interface CatalogWritePlanOptions<T> {
  readonly entries: readonly T[];
  readonly existing: readonly ExistingCatalogEntry[];
  readonly identify: (entry: T) => CatalogEntryIdentity;
}

/**
 * Decides, for one apply, what is written and what is left alone.
 *
 * Applying the same proposal twice must not produce `abayas-2`: the owner
 * clicked the same button twice, they did not create a second category. So an
 * entry the store already has is **skipped, not renamed** — matched by name
 * (case-insensitively) or by the exact slug it asks for.
 *
 * The one exception is the fallback slug. Every Arabic name slugifies to the
 * same token, so treating that collision as "already applied" would silently
 * drop every category after the first. A fallback candidate is matched by name
 * only, and de-duplicated into `category`, `category-2`, … like any other
 * collision.
 *
 * Entries repeated *within* one payload follow the same rule, so a client that
 * sends "Abayas" twice still gets one category.
 */
export function planCatalogWrite<T>({
  entries,
  existing,
  identify,
}: CatalogWritePlanOptions<T>): CatalogWritePlan<T> {
  const takenNames = new Set(
    existing.map((entry) => entry.name.trim().toLowerCase()),
  );
  const takenSlugs = new Set(existing.map((entry) => entry.slug));

  const create: PlannedCatalogEntry<T>[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    const { name, candidate, isFallbackCandidate } = identify(entry);
    const normalizedName = name.trim().toLowerCase();

    const exists =
      takenNames.has(normalizedName) ||
      (!isFallbackCandidate && takenSlugs.has(candidate));
    if (exists) {
      skipped.push(candidate);
      continue;
    }

    const slug = buildUniqueSlug({ candidate, taken: takenSlugs });
    takenNames.add(normalizedName);
    takenSlugs.add(slug);
    create.push({ entry, slug });
  }

  return { create, skipped };
}
