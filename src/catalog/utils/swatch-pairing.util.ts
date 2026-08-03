import { SWATCH_HEX_PATTERN } from '../catalog.constants';
import { AttributeDisplayStyle } from '../enums/attribute-display-style.enum';

/** Only the two fields the rendering contract talks about. */
export interface SwatchPairingValue {
  readonly value: string;
  readonly swatchHex?: string | null;
}

export interface SwatchPairingInput {
  readonly displayStyle: AttributeDisplayStyle;
  readonly values: readonly SwatchPairingValue[];
}

/**
 * The rendering contract, as a pure check: a `swatch` attribute needs a valid
 * `#RRGGBB` on **every** value, because a colourless colour swatch renders as
 * an invisible button; any other style must carry none, because storing a
 * colour nothing will ever render is how a schema accumulates lies.
 *
 * Returns the display text of every value that breaks it, so the 400 can name
 * them instead of saying "something is wrong".
 */
export function findSwatchPairingViolations({
  displayStyle,
  values,
}: SwatchPairingInput): string[] {
  const requiresHex = displayStyle === AttributeDisplayStyle.Swatch;

  return values
    .filter((value) =>
      requiresHex
        ? !value.swatchHex || !SWATCH_HEX_PATTERN.test(value.swatchHex)
        : Boolean(value.swatchHex),
    )
    .map((value) => value.value);
}
