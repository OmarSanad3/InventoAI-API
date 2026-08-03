import { RESERVED_ATTRIBUTE_KEYS } from '../catalog.constants';
import { isReservedAttributeKey } from './reserved-attribute-key.util';

describe('isReservedAttributeKey', () => {
  it.each(RESERVED_ATTRIBUTE_KEYS)('rejects the built-in %s', (inputKey) => {
    expect(isReservedAttributeKey(inputKey)).toBe(true);
  });

  it('rejects a reserved key whatever its case', () => {
    expect(isReservedAttributeKey('Sort')).toBe(true);
    expect(isReservedAttributeKey('MINPRICE')).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(isReservedAttributeKey('  category  ')).toBe(true);
  });

  it('accepts a key a store would actually define', () => {
    expect(isReservedAttributeKey('size')).toBe(false);
    expect(isReservedAttributeKey('color')).toBe(false);
    expect(isReservedAttributeKey('material')).toBe(false);
  });

  it('accepts a key that merely contains a reserved one', () => {
    expect(isReservedAttributeKey('category-type')).toBe(false);
    expect(isReservedAttributeKey('page-count')).toBe(false);
  });
});
