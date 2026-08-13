import {
  SEARCH_MAX_TOKENS,
  SEARCH_MIN_QUERY_LENGTH,
  SEARCH_QUERY_MAX_LENGTH,
} from '../catalog.constants';

/**
 * Anything that is not a letter, a digit or whitespace. `to_tsquery` takes an
 * *operator expression*, not prose, and throws `42601` on anything malformed —
 * `&`, `|`, `!`, `(`, `)`, `:`, `*` and quotes are all syntax there. Stripping
 * rather than escaping is what makes a malformed query impossible instead of
 * merely unlikely, and the Unicode classes are what keep Arabic intact.
 */
const NON_SEARCHABLE = /[^\p{L}\p{N}\s]+/gu;

export interface SearchQuery {
  /** Safe to interpolate into `to_tsquery`. */
  readonly tsquery: string;
  /** The trimmed original, for the trigram fallback and did-you-mean. */
  readonly term: string;
}

/**
 * Turns what a shopper typed into a `tsquery` Postgres will accept.
 *
 * Returns `null` when there is nothing to search for — an absent, too-short or
 * punctuation-only term is not a filter, and must not become an error page.
 */
export function buildSearchQuery(raw: string | undefined): SearchQuery | null {
  const term = (raw ?? '').trim().slice(0, SEARCH_QUERY_MAX_LENGTH).trim();
  if (term.length < SEARCH_MIN_QUERY_LENGTH) {
    return null;
  }

  // Replaced with a space rather than removed: `t-shirt` becomes `t & shirt`,
  // which matches the `'t-shirt' 't' 'shirt'` Postgres indexes for "T-Shirt".
  // Removing the hyphen instead would produce `tshirt`, which matches nothing.
  const tokens = term
    .replace(NON_SEARCHABLE, ' ')
    .split(/\s+/u)
    .filter((token) => token.length > 0)
    .slice(0, SEARCH_MAX_TOKENS);
  if (tokens.length === 0) {
    return null;
  }

  // AND, so more words narrow the results rather than flooding them, and `:*`
  // on the last token only, so a half-typed final word still matches while the
  // words the shopper finished stay exact.
  const lastAt = tokens.length - 1;
  const tsquery = tokens
    .map((token, index) => (index === lastAt ? `${token}:*` : token))
    .join(' & ');

  return { tsquery, term };
}
