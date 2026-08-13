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

export const PRODUCT_TITLE_MIN_LENGTH = 2;
export const PRODUCT_TITLE_MAX_LENGTH = 140;
export const PRODUCT_SLUG_MIN_LENGTH = 2;
export const PRODUCT_SLUG_MAX_LENGTH = 160;
export const PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH = 300;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 5000;
export const PRODUCT_SEARCH_KEYWORDS_MAX_LENGTH = 200;
export const PRODUCT_SKU_MAX_LENGTH = 64;
export const PRODUCT_IMAGE_ALT_TEXT_MAX_LENGTH = 200;

export const PRODUCT_SUBFOLDER = 'products';
export const PRODUCT_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_MIME_TYPE_PATTERN = /^image\/(png|jpeg|webp)$/;
export const MAX_PRODUCT_IMAGES = 8;
export const MAX_PRODUCT_CATEGORIES = 10;
export const MAX_PRODUCT_ATTRIBUTE_VALUES = 30;

export const MAX_VARIANT_AXES_PER_PRODUCT = 3;
export const MAX_VARIANTS_PER_PRODUCT = 100;

export const MAX_FILTER_FACETS = 10;
export const MAX_FILTER_VALUES_PER_FACET = 20;

/** The text-search config baked into the generated column. Must stay a literal. */
export const SEARCH_TEXT_CONFIG = 'english';
/**
 * What actually reaches Postgres. `buildSearchQuery` **truncates** to this —
 * a shopper who pasted an essay gets results, not a 400.
 */
export const SEARCH_QUERY_MAX_LENGTH = 100;
/**
 * The outer bound the DTO rejects at. Deliberately far above
 * `SEARCH_QUERY_MAX_LENGTH`: this is the "someone is probing us" limit, not the
 * "your query is too long" one.
 */
export const SEARCH_INPUT_MAX_LENGTH = 2000;
export const SEARCH_MAX_TOKENS = 8;
/** Below this the frontend should not fire; the backend also treats it as no search. */
export const SEARCH_MIN_QUERY_LENGTH = 2;
/** ts_rank_cd normalisation: divide by rank + 1, so scores land in 0..1. */
export const SEARCH_RANK_NORMALIZATION = 32;
/** Pinned rather than inherited from pg_trgm.word_similarity_threshold (0.6). */
export const SEARCH_WORD_SIMILARITY_THRESHOLD = 0.6;
export const SEARCH_SUGGEST_LIMIT = 5;

/** 100,000,000 minor units = 1,000,000.00 — a sane ceiling, not a business rule. */
export const MAX_PRICE_AMOUNT = 100_000_000;
export const MAX_STOCK_QUANTITY = 1_000_000;
/** How many featured products the landing page lists. */
export const MAX_FEATURED_PRODUCTS = 8;
/** Above this the storefront reports "in stock" rather than a number. */
export const PUBLIC_STOCK_HINT_THRESHOLD = 5;

/**
 * Join tables. `product_descriptive_values` deliberately does **not** reuse the
 * name `product_attribute_values` the spec sketched: that is already the table
 * of the `ProductAttributeValue` entity itself, so the two would collide.
 */
export const PRODUCT_CATEGORIES_TABLE = 'product_categories';
export const PRODUCT_DESCRIPTIVE_VALUES_TABLE = 'product_descriptive_values';
export const VARIANT_ATTRIBUTE_VALUES_TABLE = 'variant_attribute_values';

/** How many categories one AI generation may propose. */
export const MIN_GENERATED_CATEGORIES = 3;
export const MAX_GENERATED_CATEGORIES = 12;
/** Zero is a valid answer: a bookshop needs no size and no colour. */
export const MAX_GENERATED_ATTRIBUTES = 6;
/**
 * A generated attribute with one value filters nothing — every product matches
 * it — so the sanitiser drops it rather than proposing dead weight.
 */
export const MIN_GENERATED_VALUES_PER_ATTRIBUTE = 2;
export const MAX_GENERATION_INSTRUCTIONS_LENGTH = 500;
/** A button an impatient owner will click repeatedly; Gemini calls cost money. */
export const CATALOG_GENERATION_COOLDOWN_SECONDS = 30;
export const CATALOG_GENERATION_ATTEMPTS = 2;
export const CATALOG_GENERATION_TEMPERATURE = 0.7;

/** Slug fallbacks for names written in a script with no Latin characters. */
export const CATEGORY_SLUG_FALLBACK = 'category';
export const ATTRIBUTE_KEY_FALLBACK = 'attribute';

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
