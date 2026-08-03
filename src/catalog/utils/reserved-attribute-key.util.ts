import { RESERVED_ATTRIBUTE_KEYS } from '../catalog.constants';

/**
 * Whether a key collides with a built-in products-page query parameter. Checked
 * case-insensitively: `Sort` reaches the storefront as `sort` and would be
 * indistinguishable from the sort control.
 */
export function isReservedAttributeKey(key: string): boolean {
  return RESERVED_ATTRIBUTE_KEYS.includes(key.trim().toLowerCase());
}
