import { randomBytes } from 'node:crypto';
import { MAX_SLUG_ATTEMPTS } from '../catalog.constants';

const RANDOM_SUFFIX_BYTES = 3;

export interface UniqueSlugOptions {
  /** The desired slug, already slugified. */
  readonly candidate: string;
  /** Slugs already used by the same store. */
  readonly taken: ReadonlySet<string>;
}

/**
 * Picks a slug that is free within a store: the candidate itself, else the
 * first free `candidate-2`, `candidate-3`, … Once the numeric attempts are
 * exhausted it falls back to a random suffix rather than looping forever.
 */
export function buildUniqueSlug({
  candidate,
  taken,
}: UniqueSlugOptions): string {
  if (!taken.has(candidate)) {
    return candidate;
  }

  for (let suffix = 2; suffix <= MAX_SLUG_ATTEMPTS; suffix++) {
    const attempt = `${candidate}-${suffix}`;
    if (!taken.has(attempt)) {
      return attempt;
    }
  }

  return `${candidate}-${randomBytes(RANDOM_SUFFIX_BYTES).toString('hex')}`;
}
