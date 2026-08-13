import {
  MAX_FILTER_FACETS,
  MAX_FILTER_VALUES_PER_FACET,
} from '../catalog.constants';

const FACET_SEPARATOR = ';';
const KEY_VALUE_SEPARATOR = ':';
const VALUE_SEPARATOR = ',';

/**
 * Parses the storefront's one whitelisted custom-facet parameter:
 *
 * ```
 * ?attributes=size:xl,l;color:red
 * ```
 *
 * One parameter rather than `?size=xl` because the global `ValidationPipe` runs
 * `forbidNonWhitelisted`, and no DTO can declare a field that is a row in
 * another store's database.
 *
 * **Never throws.** The string is attacker-controlled and these URLs get
 * bookmarked and shared, so malformed input yields an empty map and a malformed
 * facet is dropped — an owner deleting a value must not turn every shared link
 * into an error page. The caps are here for the same reason.
 *
 * @returns attribute key → value slugs, meaning OR within a facet.
 */
export function parseAttributeFilter(
  raw: string | undefined,
): Map<string, string[]> {
  const facets = new Map<string, string[]>();
  if (!raw) {
    return facets;
  }

  for (const chunk of raw.split(FACET_SEPARATOR)) {
    const separatorAt = chunk.indexOf(KEY_VALUE_SEPARATOR);
    if (separatorAt < 1) {
      continue;
    }

    const key = normalize(chunk.slice(0, separatorAt));
    const values = chunk
      .slice(separatorAt + 1)
      .split(VALUE_SEPARATOR)
      .map(normalize)
      .filter((value) => value.length > 0);
    if (key.length === 0 || values.length === 0) {
      continue;
    }

    // Duplicate keys merge rather than overwrite: `size:s;size:m` means either.
    const merged = new Set([...(facets.get(key) ?? []), ...values]);
    if (!facets.has(key) && facets.size >= MAX_FILTER_FACETS) {
      continue;
    }
    facets.set(key, [...merged].slice(0, MAX_FILTER_VALUES_PER_FACET));
  }

  return facets;
}

function normalize(token: string): string {
  return token.trim().toLowerCase();
}
