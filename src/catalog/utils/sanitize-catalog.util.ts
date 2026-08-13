import {
  ATTRIBUTE_KEY_FALLBACK,
  ATTRIBUTE_KEY_MAX_LENGTH,
  ATTRIBUTE_KEY_MIN_LENGTH,
  ATTRIBUTE_NAME_MAX_LENGTH,
  ATTRIBUTE_NAME_MIN_LENGTH,
  ATTRIBUTE_VALUE_MAX_LENGTH,
  ATTRIBUTE_VALUE_MIN_LENGTH,
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  CATEGORY_NAME_MAX_LENGTH,
  CATEGORY_NAME_MIN_LENGTH,
  MAX_GENERATED_ATTRIBUTES,
  MAX_GENERATED_CATEGORIES,
  MAX_VALUES_PER_ATTRIBUTE,
  MIN_GENERATED_VALUES_PER_ATTRIBUTE,
  SWATCH_HEX_PATTERN,
} from '../catalog.constants';
import { AttributeDisplayStyle } from '../enums/attribute-display-style.enum';
import { isReservedAttributeKey } from './reserved-attribute-key.util';
import { slugifyToken } from './slugify-token.util';
import { buildUniqueSlug } from './unique-slug.util';

export interface ProposedCategory {
  readonly name: string;
  readonly description?: string;
}

export interface ProposedAttributeValue {
  readonly value: string;
  readonly swatchHex?: string;
}

export interface ProposedAttribute {
  readonly name: string;
  readonly key: string;
  readonly isVariantAxis: boolean;
  readonly displayStyle: AttributeDisplayStyle;
  readonly values: readonly ProposedAttributeValue[];
}

export interface CatalogProposal {
  readonly categories: readonly ProposedCategory[];
  readonly attributes: readonly ProposedAttribute[];
}

/**
 * Turns whatever Gemini returned into a proposal the owner can safely be shown
 * and, unedited, safely apply.
 *
 * The structured-output schema makes the parse a formality rather than the
 * defence, so every rule the create DTOs enforce is re-checked here — and
 * **dropping beats rejecting**: one malformed value must not cost the owner the
 * other eleven. Only a proposal with nothing left in it is a failure, and that
 * decision belongs to the caller (`isCatalogProposalEmpty`).
 *
 * Pure: no repository, no network, no clock. Every row of the spec's validation
 * table is unit-tested against this function.
 */
export function sanitizeGeneratedCatalog(raw: unknown): CatalogProposal {
  const source = isRecord(raw) ? raw : {};

  return {
    categories: sanitizeCategories(toArray(source.categories)),
    attributes: sanitizeAttributes(toArray(source.attributes)),
  };
}

/** A generation that produced neither a category nor an attribute is a retry. */
export function isCatalogProposalEmpty(proposal: CatalogProposal): boolean {
  return proposal.categories.length === 0 && proposal.attributes.length === 0;
}

function sanitizeCategories(entries: readonly unknown[]): ProposedCategory[] {
  const takenNames = new Set<string>();
  const categories: ProposedCategory[] = [];

  for (const entry of entries) {
    if (categories.length >= MAX_GENERATED_CATEGORIES) {
      break;
    }
    if (!isRecord(entry)) {
      continue;
    }

    const name = toTrimmedText(entry.name);
    if (!hasLength(name, CATEGORY_NAME_MIN_LENGTH, CATEGORY_NAME_MAX_LENGTH)) {
      continue;
    }
    if (takenNames.has(name.toLowerCase())) {
      continue;
    }
    takenNames.add(name.toLowerCase());

    categories.push({
      name,
      description: sanitizeDescription(entry.description),
    });
  }

  return categories;
}

function sanitizeAttributes(entries: readonly unknown[]): ProposedAttribute[] {
  const takenNames = new Set<string>();
  const takenKeys = new Set<string>();
  const attributes: ProposedAttribute[] = [];

  for (const entry of entries) {
    if (attributes.length >= MAX_GENERATED_ATTRIBUTES) {
      break;
    }
    const attribute = sanitizeAttribute(entry, takenNames, takenKeys);
    if (!attribute) {
      continue;
    }

    takenNames.add(attribute.name.toLowerCase());
    takenKeys.add(attribute.key);
    attributes.push(attribute);
  }

  return attributes;
}

function sanitizeAttribute(
  entry: unknown,
  takenNames: ReadonlySet<string>,
  takenKeys: ReadonlySet<string>,
): ProposedAttribute | null {
  if (!isRecord(entry)) {
    return null;
  }

  const name = toTrimmedText(entry.name);
  if (!hasLength(name, ATTRIBUTE_NAME_MIN_LENGTH, ATTRIBUTE_NAME_MAX_LENGTH)) {
    return null;
  }
  if (takenNames.has(name.toLowerCase())) {
    return null;
  }

  const key = deriveKey(entry.key, name, takenKeys);
  if (isReservedAttributeKey(key)) {
    return null;
  }

  // Bounds are applied *after* de-duplication: losing the whole attribute
  // because two of its values repeated would be the harsher of two readings.
  const values = sanitizeValues(toArray(entry.values));
  if (
    values.length < MIN_GENERATED_VALUES_PER_ATTRIBUTE ||
    values.length > MAX_VALUES_PER_ATTRIBUTE
  ) {
    return null;
  }

  const displayStyle = resolveDisplayStyle(entry.displayStyle, values);
  return {
    name,
    key,
    isVariantAxis: entry.isVariantAxis === true,
    displayStyle,
    values:
      displayStyle === AttributeDisplayStyle.Swatch
        ? values
        : values.map(({ value }) => ({ value })),
  };
}

/**
 * The model's key when it is usable, the name otherwise — and the fallback when
 * neither yields Latin characters.
 *
 * **This is the trap the spec names.** An Arabic store's attribute names all
 * slugify to the same fallback, so the candidate is de-duplicated against the
 * keys already handed out: `attribute`, `attribute-2`, … Dropping the later
 * ones instead would leave an Arabic store with exactly one attribute.
 */
function deriveKey(
  rawKey: unknown,
  name: string,
  takenKeys: ReadonlySet<string>,
): string {
  const requested = toTrimmedText(rawKey);
  const candidate = slugifyToken({
    text: requested.length > 0 ? requested : name,
    fallback: ATTRIBUTE_KEY_FALLBACK,
    maxLength: ATTRIBUTE_KEY_MAX_LENGTH,
  });

  return buildUniqueSlug({
    candidate:
      candidate.length >= ATTRIBUTE_KEY_MIN_LENGTH
        ? candidate
        : ATTRIBUTE_KEY_FALLBACK,
    taken: takenKeys,
  });
}

function sanitizeValues(entries: readonly unknown[]): ProposedAttributeValue[] {
  const taken = new Set<string>();
  const values: ProposedAttributeValue[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }

    const value = toTrimmedText(entry.value);
    if (
      !hasLength(value, ATTRIBUTE_VALUE_MIN_LENGTH, ATTRIBUTE_VALUE_MAX_LENGTH)
    ) {
      continue;
    }
    if (taken.has(value.toLowerCase())) {
      continue;
    }
    taken.add(value.toLowerCase());

    values.push({ value, swatchHex: sanitizeHex(entry.swatchHex) });
  }

  return values;
}

/**
 * `swatch` survives only when every value kept a valid colour — a colourless
 * colour swatch renders as an invisible button, so the attribute becomes a
 * `chip` instead of the proposal becoming unapplyable.
 */
function resolveDisplayStyle(
  raw: unknown,
  values: readonly ProposedAttributeValue[],
): AttributeDisplayStyle {
  const requested = isDisplayStyle(raw) ? raw : AttributeDisplayStyle.List;
  if (requested !== AttributeDisplayStyle.Swatch) {
    return requested;
  }

  return values.every((value) => value.swatchHex)
    ? AttributeDisplayStyle.Swatch
    : AttributeDisplayStyle.Chip;
}

function sanitizeDescription(raw: unknown): string | undefined {
  const description = toTrimmedText(raw);
  return hasLength(description, 1, CATEGORY_DESCRIPTION_MAX_LENGTH)
    ? description
    : undefined;
}

function sanitizeHex(raw: unknown): string | undefined {
  const hex = toTrimmedText(raw);
  return SWATCH_HEX_PATTERN.test(hex) ? hex.toLowerCase() : undefined;
}

function isDisplayStyle(raw: unknown): raw is AttributeDisplayStyle {
  return Object.values(AttributeDisplayStyle).includes(
    raw as AttributeDisplayStyle,
  );
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function toArray(raw: unknown): readonly unknown[] {
  return Array.isArray(raw) ? raw : [];
}

function toTrimmedText(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function hasLength(text: string, min: number, max: number): boolean {
  return text.length >= min && text.length <= max;
}
