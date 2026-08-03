const COMBINING_MARKS = /[̀-ͯ]/g;

export interface SlugTokenOptions {
  /** The display text to derive from — an attribute name or a value. */
  readonly text: string;
  /** Used when the text has no Latin characters at all, e.g. `أحمر`. */
  readonly fallback: string;
  readonly maxLength: number;
}

/**
 * Slugifies a catalog token: an attribute `key` or a value `slug`.
 *
 * Deliberately not `slugify()` from the site builder — that one slugifies a
 * *store name*, so it enforces `SLUG_MIN_LENGTH` (3) and falls back to
 * `my-store`. Sizes are one and two characters long, and `S` turning into
 * `my-store` is not a slug, it is a different word.
 *
 * The result may be empty of meaning but never empty of characters, and the
 * caller still de-duplicates it with `buildUniqueSlug`.
 */
export function slugifyToken({
  text,
  fallback,
  maxLength,
}: SlugTokenOptions): string {
  const slug = text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');

  return slug.length > 0 ? slug : fallback;
}
