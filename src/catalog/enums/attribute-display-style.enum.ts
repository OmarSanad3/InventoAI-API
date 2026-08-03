/**
 * How the storefront renders an attribute's values. Purely a rendering hint —
 * the backend never behaves differently on it, except for the `swatch`/
 * `swatchHex` pairing the service enforces so the client can trust the contract.
 *
 * It lives on the attribute because it is per-store configuration and the
 * frontend has nowhere else to keep it. Guessing from the attribute's name
 * breaks the moment a store calls it "Colour", "Couleur" or "اللون".
 */
export enum AttributeDisplayStyle {
  /** Checkbox list — the default. */
  List = 'list',
  /** Colour circles, filled from `swatchHex`. */
  Swatch = 'swatch',
  /** Uniform neutral circles with the value's text inside — S, M, XL. */
  Chip = 'chip',
  /** A single `<select>`, for long lists like Brand. */
  Dropdown = 'dropdown',
}
