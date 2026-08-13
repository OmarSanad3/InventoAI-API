import { BadRequestException } from '@nestjs/common';
import {
  MAX_VARIANT_AXES_PER_PRODUCT,
  MAX_VARIANTS_PER_PRODUCT,
} from '../catalog.constants';
import { buildOptionsKey } from './options-key.util';

/** One attribute value, as far as the matrix rules are concerned. */
export interface MatrixValue {
  readonly attributeId: string;
  readonly attributeName: string;
  readonly isVariantAxis: boolean;
  /** Display text, so the error can name the combination the owner sent. */
  readonly label: string;
}

export interface MatrixVariant {
  readonly attributeValueIds?: readonly string[];
}

export interface VariantMatrixInput {
  /**
   * **Every** variant the product will end up with, existing ones included —
   * adding a Colour axis to one variant of six is just as broken as submitting
   * the mismatch in a single create.
   */
  readonly variants: readonly MatrixVariant[];
  /** The values resolved from the caller's own store, keyed by id. */
  readonly valuesById: ReadonlyMap<string, MatrixValue>;
}

/**
 * Validates a product's whole variant matrix before a single row is written.
 *
 * Takes no repository: the caller resolves the ids against its store first and
 * hands the result in, which keeps every rule here pure and testable.
 *
 * @throws BadRequestException naming the offending combination.
 */
export function assertVariantMatrix({
  variants,
  valuesById,
}: VariantMatrixInput): void {
  assertVariantCount(variants);

  const signatures = variants.map((variant) =>
    buildAxisSignature(variant, valuesById),
  );
  assertOneShape(signatures);
  assertBareVariantIsAlone(variants, signatures);
  assertNoDuplicateCombination(variants, valuesById);
}

function assertVariantCount(variants: readonly MatrixVariant[]): void {
  if (variants.length === 0) {
    throw new BadRequestException('A product needs at least one variant');
  }
  if (variants.length > MAX_VARIANTS_PER_PRODUCT) {
    throw new BadRequestException(
      `A product may have at most ${MAX_VARIANTS_PER_PRODUCT} variants`,
    );
  }
}

/**
 * The attribute ids a single variant is keyed by, sorted — and every reason the
 * variant's own values could be wrong, checked on the way through.
 */
function buildAxisSignature(
  variant: MatrixVariant,
  valuesById: ReadonlyMap<string, MatrixValue>,
): string {
  const valueIds = variant.attributeValueIds ?? [];
  if (new Set(valueIds).size !== valueIds.length) {
    throw new BadRequestException(
      'A variant cannot list the same attribute value twice',
    );
  }
  if (valueIds.length > MAX_VARIANT_AXES_PER_PRODUCT) {
    throw new BadRequestException(
      `A product may be split by at most ${MAX_VARIANT_AXES_PER_PRODUCT} attributes`,
    );
  }

  const attributeIds = new Set<string>();
  for (const valueId of valueIds) {
    const value = valuesById.get(valueId);
    if (!value) {
      throw new BadRequestException(
        `attributeValueIds: "${valueId}" is not a value of your store`,
      );
    }
    if (!value.isVariantAxis) {
      throw new BadRequestException(
        `"${value.attributeName}" describes the whole product, so "${value.label}" belongs in the product's attributeValueIds, not a variant's`,
      );
    }
    if (attributeIds.has(value.attributeId)) {
      throw new BadRequestException(
        `A variant cannot carry two "${value.attributeName}" values`,
      );
    }
    attributeIds.add(value.attributeId);
  }

  return [...attributeIds].sort().join(':');
}

/**
 * Every variant must be keyed by the same axes. One variant keyed by Size and
 * another by Size + Colour gives the picker nothing to render, and their
 * `optionsKey`s would be comparing different shapes.
 */
function assertOneShape(signatures: readonly string[]): void {
  const shapes = new Set(signatures);
  if (shapes.size > 1) {
    throw new BadRequestException(
      'Every variant of a product must be defined by the same attributes',
    );
  }
}

/** The simple-product case: a variant with no axes, and only ever on its own. */
function assertBareVariantIsAlone(
  variants: readonly MatrixVariant[],
  signatures: readonly string[],
): void {
  const isBare = signatures[0] === '';
  if (isBare && variants.length > 1) {
    throw new BadRequestException(
      'Only a product with a single variant may leave that variant without attributes',
    );
  }
}

function assertNoDuplicateCombination(
  variants: readonly MatrixVariant[],
  valuesById: ReadonlyMap<string, MatrixValue>,
): void {
  const seen = new Set<string>();

  for (const variant of variants) {
    const valueIds = variant.attributeValueIds ?? [];
    const optionsKey = buildOptionsKey(valueIds);
    if (seen.has(optionsKey)) {
      const combination = valueIds
        .map((valueId) => valuesById.get(valueId)?.label ?? valueId)
        .join(' / ');
      throw new BadRequestException(
        combination.length > 0
          ? `Two variants share the combination "${combination}"`
          : 'A product cannot have two default variants',
      );
    }
    seen.add(optionsKey);
  }
}
