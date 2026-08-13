import {
  MAX_GENERATED_ATTRIBUTES,
  MAX_GENERATED_CATEGORIES,
  MAX_VALUES_PER_ATTRIBUTE,
} from '../catalog.constants';
import { AttributeDisplayStyle } from '../enums/attribute-display-style.enum';
import {
  isCatalogProposalEmpty,
  sanitizeGeneratedCatalog,
} from './sanitize-catalog.util';

/** A valid attribute, so each test can vary exactly one thing. */
function buildAttribute(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Size',
    key: 'size',
    isVariantAxis: true,
    displayStyle: 'chip',
    values: [{ value: 'S' }, { value: 'M' }],
    ...overrides,
  };
}

describe('sanitizeGeneratedCatalog', () => {
  describe('categories', () => {
    it('keeps a well-formed category with its description', () => {
      const actual = sanitizeGeneratedCatalog({
        categories: [{ name: '  Abayas  ', description: '  Everyday wear  ' }],
        attributes: [],
      });

      expect(actual.categories).toEqual([
        { name: 'Abayas', description: 'Everyday wear' },
      ]);
    });

    it('drops a category whose name is too short after trimming', () => {
      const actual = sanitizeGeneratedCatalog({
        categories: [{ name: ' A ' }, { name: 'Hijabs' }],
      });

      expect(actual.categories).toEqual([
        { name: 'Hijabs', description: undefined },
      ]);
    });

    it('drops a category whose name is too long', () => {
      const actual = sanitizeGeneratedCatalog({
        categories: [{ name: 'x'.repeat(61) }],
      });

      expect(actual.categories).toEqual([]);
    });

    it('drops the later of two names differing only in case', () => {
      const actual = sanitizeGeneratedCatalog({
        categories: [
          { name: 'Abayas', description: 'first' },
          { name: 'ABAYAS', description: 'second' },
        ],
      });

      expect(actual.categories).toEqual([
        { name: 'Abayas', description: 'first' },
      ]);
    });

    it('clears a description that exceeds the column, keeping the category', () => {
      const actual = sanitizeGeneratedCatalog({
        categories: [{ name: 'Abayas', description: 'x'.repeat(501) }],
      });

      expect(actual.categories).toEqual([
        { name: 'Abayas', description: undefined },
      ]);
    });

    it('caps the list at MAX_GENERATED_CATEGORIES', () => {
      const inputCategories = Array.from({ length: 20 }, (_, index) => ({
        name: `Category ${index}`,
      }));

      const actual = sanitizeGeneratedCatalog({
        categories: inputCategories,
      });

      expect(actual.categories).toHaveLength(MAX_GENERATED_CATEGORIES);
    });

    it('keeps two Arabic names as two distinct categories', () => {
      const actual = sanitizeGeneratedCatalog({
        categories: [{ name: 'عبايات' }, { name: 'أحذية' }],
      });

      expect(actual.categories.map((category) => category.name)).toEqual([
        'عبايات',
        'أحذية',
      ]);
    });
  });

  describe('attributes', () => {
    it('preserves value order as sent, so positions follow the shopper order', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [
          buildAttribute({
            values: [
              { value: 'S' },
              { value: 'M' },
              { value: 'L' },
              { value: 'XL' },
              { value: '2XL' },
            ],
          }),
        ],
      });

      expect(actual.attributes[0].values.map((value) => value.value)).toEqual([
        'S',
        'M',
        'L',
        'XL',
        '2XL',
      ]);
    });

    it('drops an attribute whose name is too long', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [buildAttribute({ name: 'x'.repeat(41) })],
      });

      expect(actual.attributes).toEqual([]);
    });

    it('drops an attribute with a reserved key', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [buildAttribute({ name: 'Category', key: 'category' })],
      });

      expect(actual.attributes).toEqual([]);
    });

    it('drops an attribute whose name derives a reserved key', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [buildAttribute({ name: 'Sort', key: '' })],
      });

      expect(actual.attributes).toEqual([]);
    });

    it('drops the later of two attributes with the same name', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [
          buildAttribute(),
          buildAttribute({
            key: 'sizing',
            values: [{ value: '38' }, { value: '40' }],
          }),
        ],
      });

      expect(actual.attributes).toHaveLength(1);
      expect(actual.attributes[0].key).toBe('size');
    });

    it('de-duplicates a repeated key rather than dropping the attribute', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [
          buildAttribute(),
          buildAttribute({ name: 'Shoe size', key: 'size' }),
        ],
      });

      expect(actual.attributes.map((attribute) => attribute.key)).toEqual([
        'size',
        'size-2',
      ]);
    });

    it('derives the key from the name when the model omits it', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [buildAttribute({ name: 'Fabric Type', key: null })],
      });

      expect(actual.attributes[0].key).toBe('fabric-type');
    });

    it('gives two Arabic attribute names two distinct keys, not two fallbacks', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [
          buildAttribute({ name: 'المقاس', key: 'المقاس' }),
          buildAttribute({ name: 'اللون', key: 'اللون' }),
        ],
      });

      expect(actual.attributes.map((attribute) => attribute.key)).toEqual([
        'attribute',
        'attribute-2',
      ]);
    });

    it('drops an attribute left with fewer than two values', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [buildAttribute({ values: [{ value: 'One' }] })],
      });

      expect(actual.attributes).toEqual([]);
    });

    it('drops an attribute with more than MAX_VALUES_PER_ATTRIBUTE values', () => {
      const inputValues = Array.from(
        { length: MAX_VALUES_PER_ATTRIBUTE + 1 },
        (_, index) => ({ value: `Value ${index}` }),
      );

      const actual = sanitizeGeneratedCatalog({
        attributes: [buildAttribute({ values: inputValues })],
      });

      expect(actual.attributes).toEqual([]);
    });

    it('drops the later of two values differing only in case', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [
          buildAttribute({
            values: [{ value: 'Red' }, { value: 'RED' }, { value: 'Blue' }],
          }),
        ],
      });

      expect(actual.attributes[0].values).toEqual([
        { value: 'Red' },
        { value: 'Blue' },
      ]);
    });

    it('drops a value that is longer than the column allows', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [
          buildAttribute({
            values: [{ value: 'S' }, { value: 'x'.repeat(61) }, { value: 'M' }],
          }),
        ],
      });

      expect(actual.attributes[0].values).toEqual([
        { value: 'S' },
        { value: 'M' },
      ]);
    });

    it('caps the list at MAX_GENERATED_ATTRIBUTES', () => {
      const inputAttributes = Array.from({ length: 10 }, (_, index) =>
        buildAttribute({ name: `Attribute ${index}`, key: `attr-${index}` }),
      );

      const actual = sanitizeGeneratedCatalog({
        attributes: inputAttributes,
      });

      expect(actual.attributes).toHaveLength(MAX_GENERATED_ATTRIBUTES);
    });

    it('reads a missing isVariantAxis as false', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [buildAttribute({ isVariantAxis: undefined })],
      });

      expect(actual.attributes[0].isVariantAxis).toBe(false);
    });
  });

  describe('display style', () => {
    it('coerces an unknown style to list', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [buildAttribute({ displayStyle: 'carousel' })],
      });

      expect(actual.attributes[0].displayStyle).toBe(
        AttributeDisplayStyle.List,
      );
    });

    it('keeps swatch when every value carries a valid colour', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [
          buildAttribute({
            name: 'Colour',
            key: 'colour',
            displayStyle: 'swatch',
            values: [
              { value: 'Black', swatchHex: '#111827' },
              { value: 'Beige', swatchHex: '#D6C7AE' },
            ],
          }),
        ],
      });

      expect(actual.attributes[0]).toMatchObject({
        displayStyle: AttributeDisplayStyle.Swatch,
        values: [
          { value: 'Black', swatchHex: '#111827' },
          { value: 'Beige', swatchHex: '#d6c7ae' },
        ],
      });
    });

    it('turns a swatch with one bad hex into a chip and strips the colours', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [
          buildAttribute({
            name: 'Colour',
            key: 'colour',
            displayStyle: 'swatch',
            values: [
              { value: 'Black', swatchHex: '#111827' },
              { value: 'Beige', swatchHex: '#f00' },
            ],
          }),
        ],
      });

      expect(actual.attributes[0]).toMatchObject({
        displayStyle: AttributeDisplayStyle.Chip,
        values: [{ value: 'Black' }, { value: 'Beige' }],
      });
    });

    it('turns a swatch missing a hex entirely into a chip', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [
          buildAttribute({
            displayStyle: 'swatch',
            values: [
              { value: 'Black', swatchHex: '#111827' },
              { value: 'Beige' },
            ],
          }),
        ],
      });

      expect(actual.attributes[0].displayStyle).toBe(
        AttributeDisplayStyle.Chip,
      );
    });

    it('strips colours from a non-swatch attribute', () => {
      const actual = sanitizeGeneratedCatalog({
        attributes: [
          buildAttribute({
            displayStyle: 'list',
            values: [
              { value: 'Crepe', swatchHex: '#111827' },
              { value: 'Linen', swatchHex: '#d6c7ae' },
            ],
          }),
        ],
      });

      expect(actual.attributes[0].values).toEqual([
        { value: 'Crepe' },
        { value: 'Linen' },
      ]);
    });
  });

  describe('malformed input', () => {
    it('returns an empty proposal for a non-object', () => {
      const actual = sanitizeGeneratedCatalog('not json');

      expect(actual).toEqual({ categories: [], attributes: [] });
      expect(isCatalogProposalEmpty(actual)).toBe(true);
    });

    it('returns an empty proposal when both arrays are missing', () => {
      expect(isCatalogProposalEmpty(sanitizeGeneratedCatalog({}))).toBe(true);
    });

    it('ignores entries that are not objects', () => {
      const actual = sanitizeGeneratedCatalog({
        categories: ['Abayas', null, { name: 'Hijabs' }],
        attributes: [42, buildAttribute()],
      });

      expect(actual.categories).toHaveLength(1);
      expect(actual.attributes).toHaveLength(1);
    });

    it('treats an empty attribute list as valid, not as a failure', () => {
      const actual = sanitizeGeneratedCatalog({
        categories: [{ name: 'Fiction' }, { name: 'Poetry' }],
        attributes: [],
      });

      expect(actual.attributes).toEqual([]);
      expect(isCatalogProposalEmpty(actual)).toBe(false);
    });
  });
});
