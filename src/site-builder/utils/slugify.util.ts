import { SLUG_MAX_LENGTH, SLUG_MIN_LENGTH } from '../site-builder.constants';

/** Used when a name has no Latin characters to slugify, e.g. an Arabic name. */
export const SLUG_FALLBACK = 'my-store';

const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Turns a business name into a slug candidate: lowercase, diacritics stripped,
 * everything else collapsed into single hyphens. The result is only a
 * suggestion — availability is still checked before it is reserved.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');

  return slug.length >= SLUG_MIN_LENGTH ? slug : SLUG_FALLBACK;
}
