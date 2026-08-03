export const CATEGORY_NAME_MIN_LENGTH = 2;
export const CATEGORY_NAME_MAX_LENGTH = 60;
export const CATEGORY_SLUG_MIN_LENGTH = 2;
export const CATEGORY_SLUG_MAX_LENGTH = 60;
export const CATEGORY_DESCRIPTION_MAX_LENGTH = 500;

export const CATEGORY_SUBFOLDER = 'categories';
export const CATEGORY_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const CATEGORY_IMAGE_MIME_TYPE_PATTERN = /^image\/(png|jpeg|webp)$/;

/** How many featured categories the landing page lists. */
export const MAX_FEATURED_CATEGORIES = 6;

/** Numeric suffixes tried before falling back to a random one. */
export const MAX_SLUG_ATTEMPTS = 20;

export const ATTRIBUTE_NAME_MIN_LENGTH = 2;
export const ATTRIBUTE_NAME_MAX_LENGTH = 40;
export const ATTRIBUTE_KEY_MIN_LENGTH = 2;
export const ATTRIBUTE_KEY_MAX_LENGTH = 40;
export const ATTRIBUTE_VALUE_MIN_LENGTH = 1;
export const ATTRIBUTE_VALUE_MAX_LENGTH = 60;
export const ATTRIBUTE_VALUE_SLUG_MIN_LENGTH = 1;
export const ATTRIBUTE_VALUE_SLUG_MAX_LENGTH = 60;

export const MAX_ATTRIBUTES_PER_STORE = 20;
export const MAX_VALUES_PER_ATTRIBUTE = 100;

export const SWATCH_HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Keys the storefront's products page already spends on built-in controls. An
 * attribute keyed `sort` would be indistinguishable from the sort control.
 */
export const RESERVED_ATTRIBUTE_KEYS: readonly string[] = [
  'category',
  'search',
  'sort',
  'order',
  'page',
  'limit',
  'minprice',
  'maxprice',
  'instock',
  'attributes',
];
