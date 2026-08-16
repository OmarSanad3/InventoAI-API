/** What a label needs from a loaded attribute value. */
export interface LabelledValue {
  readonly value: string;
  readonly position?: number;
  readonly attribute?: {
    readonly name: string;
    readonly position?: number;
  } | null;
}

/**
 * `"Size: M, Colour: Black"` — a variant named the way its picker reads.
 *
 * `null` for a simple product's lone default variant, which has no options and
 * whose product title already says everything there is to say.
 *
 * Ordered by the attribute's own position for the same reason the order
 * snapshot is: Size before Colour is the owner's decision, not Postgres'.
 */
export function buildVariantLabel(variant: {
  attributeValues?: readonly LabelledValue[] | null;
}): string | null {
  const values = variant.attributeValues ?? [];
  if (values.length === 0) {
    return null;
  }

  const parts = [...values]
    .sort(byAttributeThenValue)
    .filter((value) => Boolean(value.attribute?.name))
    .map((value) => `${value.attribute?.name}: ${value.value}`);

  return parts.length > 0 ? parts.join(', ') : null;
}

function byAttributeThenValue(a: LabelledValue, b: LabelledValue): number {
  const byAttribute =
    (a.attribute?.position ?? 0) - (b.attribute?.position ?? 0);
  if (byAttribute !== 0) {
    return byAttribute;
  }
  return (a.position ?? 0) - (b.position ?? 0);
}
