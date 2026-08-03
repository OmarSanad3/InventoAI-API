import { AttributeDisplayStyle } from '../enums/attribute-display-style.enum';
import { findSwatchPairingViolations } from './swatch-pairing.util';

describe('findSwatchPairingViolations', () => {
  describe('a swatch attribute', () => {
    it('accepts values that all carry a #RRGGBB colour', () => {
      const actual = findSwatchPairingViolations({
        displayStyle: AttributeDisplayStyle.Swatch,
        values: [
          { value: 'Red', swatchHex: '#e11d48' },
          { value: 'Blue', swatchHex: '#2563EB' },
        ],
      });

      expect(actual).toEqual([]);
    });

    it('names every value missing a colour', () => {
      const actual = findSwatchPairingViolations({
        displayStyle: AttributeDisplayStyle.Swatch,
        values: [
          { value: 'Red', swatchHex: '#e11d48' },
          { value: 'Blue' },
          { value: 'Green', swatchHex: null },
        ],
      });

      expect(actual).toEqual(['Blue', 'Green']);
    });

    it('rejects a three-digit shorthand colour', () => {
      const actual = findSwatchPairingViolations({
        displayStyle: AttributeDisplayStyle.Swatch,
        values: [{ value: 'Red', swatchHex: '#f00' }],
      });

      expect(actual).toEqual(['Red']);
    });

    it('rejects a colour without its hash', () => {
      const actual = findSwatchPairingViolations({
        displayStyle: AttributeDisplayStyle.Swatch,
        values: [{ value: 'Red', swatchHex: 'e11d48' }],
      });

      expect(actual).toEqual(['Red']);
    });

    it('accepts an attribute with no values yet', () => {
      const actual = findSwatchPairingViolations({
        displayStyle: AttributeDisplayStyle.Swatch,
        values: [],
      });

      expect(actual).toEqual([]);
    });
  });

  describe('every other style', () => {
    it.each([
      AttributeDisplayStyle.List,
      AttributeDisplayStyle.Chip,
      AttributeDisplayStyle.Dropdown,
    ])('names the values carrying a colour under %s', (inputStyle) => {
      const actual = findSwatchPairingViolations({
        displayStyle: inputStyle,
        values: [{ value: 'S' }, { value: 'M', swatchHex: '#e11d48' }],
      });

      expect(actual).toEqual(['M']);
    });

    it('accepts colourless values', () => {
      const actual = findSwatchPairingViolations({
        displayStyle: AttributeDisplayStyle.Chip,
        values: [
          { value: 'S' },
          { value: 'M', swatchHex: null },
          { value: 'L', swatchHex: '' },
        ],
      });

      expect(actual).toEqual([]);
    });
  });
});
