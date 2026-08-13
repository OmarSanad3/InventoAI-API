import { BadRequestException } from '@nestjs/common';
import { MAX_VARIANTS_PER_PRODUCT } from '../catalog.constants';
import {
  assertVariantMatrix,
  MatrixValue,
  MatrixVariant,
} from './variant-matrix.util';

const SIZE_ATTRIBUTE = 'attr-size';
const COLOUR_ATTRIBUTE = 'attr-colour';
const MATERIAL_ATTRIBUTE = 'attr-material';

function axisValue(attributeId: string, label: string): MatrixValue {
  return {
    attributeId,
    attributeName: attributeId,
    isVariantAxis: true,
    label,
  };
}

const mockValuesById = new Map<string, MatrixValue>([
  ['size-s', axisValue(SIZE_ATTRIBUTE, 'S')],
  ['size-m', axisValue(SIZE_ATTRIBUTE, 'M')],
  ['colour-red', axisValue(COLOUR_ATTRIBUTE, 'Red')],
  ['colour-blue', axisValue(COLOUR_ATTRIBUTE, 'Blue')],
  [
    'material-cotton',
    {
      attributeId: MATERIAL_ATTRIBUTE,
      attributeName: 'Material',
      isVariantAxis: false,
      label: 'Cotton',
    },
  ],
]);

function assertMatrix(variants: MatrixVariant[]): void {
  assertVariantMatrix({ variants, valuesById: mockValuesById });
}

describe('assertVariantMatrix', () => {
  it('accepts a lone variant with no attributes — the simple product', () => {
    expect(() => assertMatrix([{}])).not.toThrow();
  });

  it('accepts a full matrix of two axes', () => {
    expect(() =>
      assertMatrix([
        { attributeValueIds: ['size-s', 'colour-red'] },
        { attributeValueIds: ['size-s', 'colour-blue'] },
        { attributeValueIds: ['size-m', 'colour-red'] },
        { attributeValueIds: ['size-m', 'colour-blue'] },
      ]),
    ).not.toThrow();
  });

  it('rejects a duplicated combination, whatever order it was sent in', () => {
    expect(() =>
      assertMatrix([
        { attributeValueIds: ['size-s', 'colour-red'] },
        { attributeValueIds: ['colour-red', 'size-s'] },
      ]),
    ).toThrow(BadRequestException);
  });

  it('rejects variants keyed by different axes', () => {
    expect(() =>
      assertMatrix([
        { attributeValueIds: ['size-s'] },
        { attributeValueIds: ['size-m', 'colour-red'] },
      ]),
    ).toThrow(/same attributes/);
  });

  it('rejects a descriptive value used as an axis', () => {
    expect(() =>
      assertMatrix([{ attributeValueIds: ['material-cotton'] }]),
    ).toThrow(/describes the whole product/);
  });

  it('rejects a value that is not in the store', () => {
    expect(() => assertMatrix([{ attributeValueIds: ['size-xxl'] }])).toThrow(
      /not a value of your store/,
    );
  });

  it('rejects two values of the same attribute on one variant', () => {
    expect(() =>
      assertMatrix([{ attributeValueIds: ['size-s', 'size-m'] }]),
    ).toThrow(/two/);
  });

  it('rejects a bare variant alongside others', () => {
    expect(() =>
      assertMatrix([{ attributeValueIds: ['size-s'] }, {}]),
    ).toThrow();
  });

  it('rejects an empty variant list', () => {
    expect(() => assertMatrix([])).toThrow(/at least one variant/);
  });

  it('enforces the axis cap', () => {
    expect(() =>
      assertMatrix([
        {
          attributeValueIds: [
            'size-s',
            'colour-red',
            'material-cotton',
            'size-m',
          ],
        },
      ]),
    ).toThrow(/at most/);
  });

  it('enforces the variant cap', () => {
    const inputVariants = Array.from(
      { length: MAX_VARIANTS_PER_PRODUCT + 1 },
      () => ({ attributeValueIds: ['size-s'] }),
    );
    expect(() => assertMatrix(inputVariants)).toThrow(
      `A product may have at most ${MAX_VARIANTS_PER_PRODUCT} variants`,
    );
  });

  it('rejects the same value listed twice on one variant', () => {
    expect(() =>
      assertMatrix([{ attributeValueIds: ['size-s', 'size-s'] }]),
    ).toThrow(/twice/);
  });
});
