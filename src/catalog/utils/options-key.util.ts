/**
 * Materialises a variant's attribute combination into the single string the
 * `UQ_variants_product_options` unique index guards.
 *
 * Sorted, so `Red/M` and `M/Red` collide as they must — the same combination
 * entered in two orders is the same variant, and letting both exist shows up
 * only as a shopper adding the wrong row to their cart.
 *
 * A variant with no options yields `''`, which the same index makes unique: a
 * product cannot have two default variants.
 */
export function buildOptionsKey(valueIds: readonly string[] = []): string {
  return [...valueIds].sort().join(':');
}
