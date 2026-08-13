import {
  MAX_FILTER_FACETS,
  MAX_FILTER_VALUES_PER_FACET,
} from '../catalog.constants';
import { parseAttributeFilter } from './attribute-filter.util';

describe('parseAttributeFilter', () => {
  it('parses the documented grammar', () => {
    const actual = parseAttributeFilter('size:xl,l;color:red');

    expect(actual.get('size')).toEqual(['xl', 'l']);
    expect(actual.get('color')).toEqual(['red']);
    expect(actual.size).toBe(2);
  });

  it('returns an empty map for an absent or empty parameter', () => {
    expect(parseAttributeFilter(undefined).size).toBe(0);
    expect(parseAttributeFilter('').size).toBe(0);
  });

  it('drops malformed facets instead of throwing', () => {
    const inputs = [';;;', ':::', 'size', 'size:', ':xl', ',,,', '::;;,,'];

    for (const input of inputs) {
      expect(() => parseAttributeFilter(input)).not.toThrow();
      expect(parseAttributeFilter(input).size).toBe(0);
    }
  });

  it('keeps the valid facets of a partly malformed string', () => {
    const actual = parseAttributeFilter('size:xl;;garbage;color:red');

    expect([...actual.keys()]).toEqual(['size', 'color']);
  });

  it('normalises case and whitespace', () => {
    const actual = parseAttributeFilter(' SIZE : XL , L ');

    expect(actual.get('size')).toEqual(['xl', 'l']);
  });

  it('merges duplicate keys rather than overwriting them', () => {
    const actual = parseAttributeFilter('size:s;size:m');

    expect(actual.get('size')).toEqual(['s', 'm']);
  });

  it('de-duplicates repeated values', () => {
    expect(parseAttributeFilter('size:s,s,s').get('size')).toEqual(['s']);
  });

  it('caps the number of facets', () => {
    const input = Array.from(
      { length: MAX_FILTER_FACETS + 5 },
      (_, index) => `key${index}:value`,
    ).join(';');

    expect(parseAttributeFilter(input).size).toBe(MAX_FILTER_FACETS);
  });

  it('caps the number of values in a facet', () => {
    const values = Array.from(
      { length: MAX_FILTER_VALUES_PER_FACET + 5 },
      (_, index) => `value${index}`,
    ).join(',');

    expect(parseAttributeFilter(`size:${values}`).get('size')).toHaveLength(
      MAX_FILTER_VALUES_PER_FACET,
    );
  });
});
