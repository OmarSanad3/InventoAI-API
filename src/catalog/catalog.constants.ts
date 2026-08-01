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
