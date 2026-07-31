import { SLUG_MAX_CONFUSABLE_DISTANCE } from '../site-builder.constants';

/**
 * Two slugs a customer could mistake for one another: the same string once
 * hyphens are ignored, a singular/plural pair such as `toys-city` and
 * `toys-cities`, or within a couple of edits of each other.
 */
export function isConfusableSlug(slug: string, other: string): boolean {
  if (slug === other) {
    return true;
  }
  if (stripHyphens(slug) === stripHyphens(other)) {
    return true;
  }
  if (
    buildSlugVariants(slug).includes(other) ||
    buildSlugVariants(other).includes(slug)
  ) {
    return true;
  }
  return (
    computeEditDistance(slug, other, SLUG_MAX_CONFUSABLE_DISTANCE) <=
    SLUG_MAX_CONFUSABLE_DISTANCE
  );
}

/**
 * Cheap candidates to pre-filter with in SQL, so the edit-distance comparison
 * only runs over a handful of rows: plural/singular forms and the hyphen-free
 * spelling.
 */
export function buildSlugVariants(slug: string): string[] {
  const variants = new Set<string>([slug, stripHyphens(slug)]);

  if (slug.endsWith('ies')) {
    variants.add(`${slug.slice(0, -3)}y`);
  }
  if (slug.endsWith('es')) {
    variants.add(slug.slice(0, -2));
  }
  if (slug.endsWith('s')) {
    variants.add(slug.slice(0, -1));
  } else {
    variants.add(`${slug}s`);
    variants.add(`${slug}es`);
  }
  if (slug.endsWith('y')) {
    variants.add(`${slug.slice(0, -1)}ies`);
  }

  return [...variants];
}

function stripHyphens(slug: string): string {
  return slug.replace(/-/g, '');
}

/** Levenshtein distance, abandoned early once it exceeds `limit`. */
function computeEditDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) {
    return limit + 1;
  }

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost,
      );
    }
    if (Math.min(...current) > limit) {
      return limit + 1;
    }
    previous = current;
  }

  return previous[b.length];
}
