import { createHash } from 'node:crypto';
import { KNOWLEDGE_DOCUMENT_MAX_CHARS } from '../knowledge.constants';

export interface DescriptiveValueInput {
  readonly attribute: string;
  readonly value: string;
}

export interface ProductDocumentInput {
  readonly title: string;
  readonly shortDescription?: string | null;
  readonly description?: string | null;
  readonly searchKeywords?: string | null;
  readonly categoryNames?: readonly string[];
  readonly descriptiveValues?: readonly DescriptiveValueInput[];
}

export interface FaqDocumentInput {
  readonly question: string;
  readonly answer: string;
}

export interface CategoryDocumentInput {
  readonly name: string;
  readonly description?: string | null;
}

export interface StoreProfileDocumentInput {
  readonly name: string;
  readonly description?: string | null;
  /** `SiteBuilderService.describeBusinessForOwner` — the answered questionnaire. */
  readonly businessSummary?: string | null;
}

/**
 * What every builder returns: one plain string, ready to embed.
 *
 * The rules they all obey, from the epic's §3:
 *
 * - **No price, no stock, no SKU.** Those are the most volatile fields on a
 *   product, and including them would mean re-embedding every time an owner
 *   nudges a price. They are fetched live when the answer is built.
 * - **No variant axis labels.** "S, M, L, XL" adds nothing a shopper searches by
 *   and dilutes the vector; descriptive attributes (Material, Brand, Author) are
 *   exactly the ones that do belong.
 * - A label prefix on each part, so a model reading a retrieved snippet knows
 *   what it is looking at.
 * - Whitespace collapsed, so a reformat is not a re-embed.
 */
export function buildProductDocument(input: ProductDocumentInput): string {
  const categories = input.categoryNames?.filter(Boolean) ?? [];

  return composeDocument([
    labelled('Product', input.title),
    clean(input.shortDescription),
    clean(input.description),
    labelled('Keywords', input.searchKeywords),
    labelled('Categories', categories.join(', ')),
    ...describeAttributes(input.descriptiveValues ?? []),
  ]);
}

export function buildFaqDocument(input: FaqDocumentInput): string {
  return composeDocument([
    labelled('FAQ', input.question),
    labelled('Answer', input.answer),
  ]);
}

export function buildCategoryDocument(input: CategoryDocumentInput): string {
  return composeDocument([
    labelled('Category', input.name),
    clean(input.description),
  ]);
}

export function buildStoreProfileDocument(
  input: StoreProfileDocumentInput,
): string {
  return composeDocument([
    labelled('Store', input.name),
    labelled('About', input.description),
    labelled('Business', input.businessSummary),
  ]);
}

/**
 * SHA-256 hex of a composed document. The whole freshness optimisation lives
 * here: the sweeper composes, hashes, and clears the stale flag without
 * spending an embedding call when the hash has not moved.
 */
export function hashDocumentContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Groups values under their attribute so a document reads `Material: Ceramic,
 * Stoneware` rather than repeating the attribute per value. Insertion order is
 * kept — `Map` preserves it, and a sort here would only scramble the owner's.
 */
function describeAttributes(
  values: readonly DescriptiveValueInput[],
): string[] {
  const byAttribute = new Map<string, string[]>();

  for (const { attribute, value } of values) {
    const attributeName = clean(attribute);
    const valueName = clean(value);
    if (!attributeName || !valueName) {
      continue;
    }
    const existing = byAttribute.get(attributeName);
    if (existing) {
      existing.push(valueName);
    } else {
      byAttribute.set(attributeName, [valueName]);
    }
  }

  return [...byAttribute].map(([attribute, names]) =>
    labelled(attribute, names.join(', ')),
  );
}

/** Drops the empty parts, joins with newlines, and enforces the cap. */
function composeDocument(parts: readonly string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .join('\n')
    .slice(0, KNOWLEDGE_DOCUMENT_MAX_CHARS);
}

function labelled(label: string, text: string | null | undefined): string {
  const value = clean(text);
  return value ? `${label}: ${value}` : '';
}

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}
