/** The shape of a loaded attribute value, reduced to what a snapshot needs. */
export interface SnapshotValue {
  readonly value: string;
  readonly position?: number;
  readonly attribute?: {
    readonly name: string;
    readonly position?: number;
  } | null;
}

/**
 * The `{ "Size": "M", "Colour": "Red" }` snapshot stored on an order line.
 *
 * **Labels, not ids**, and ordered by the attribute's own position so an order
 * reads the way the picker did. Renaming "M" to "Medium" afterwards must move
 * every live product and no past order, which is exactly what storing the text
 * here buys.
 */
export function buildVariantOptions(
  values: readonly SnapshotValue[] = [],
): Record<string, string> {
  return [...values]
    .sort(byAttributeThenValue)
    .reduce<Record<string, string>>((options, value) => {
      const name = value.attribute?.name;
      if (name) {
        options[name] = value.value;
      }
      return options;
    }, {});
}

/**
 * How a line is named when checkout has to refuse it — "Blue Mug — Size M".
 * The options are the point: "out of stock" on a product sold in six sizes tells
 * the shopper nothing about which one to change.
 */
export function describeVariant({
  title,
  options,
}: {
  title: string;
  options: Record<string, string>;
}): string {
  const entries = Object.entries(options);
  if (entries.length === 0) {
    return title;
  }
  return `${title} — ${entries.map(([name, value]) => `${name} ${value}`).join(', ')}`;
}

function byAttributeThenValue(a: SnapshotValue, b: SnapshotValue): number {
  const byAttribute =
    (a.attribute?.position ?? 0) - (b.attribute?.position ?? 0);
  if (byAttribute !== 0) {
    return byAttribute;
  }
  return (a.position ?? 0) - (b.position ?? 0);
}
