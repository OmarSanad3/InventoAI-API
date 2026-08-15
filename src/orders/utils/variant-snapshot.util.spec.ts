import { buildVariantOptions, describeVariant } from './variant-snapshot.util';

describe('buildVariantOptions', () => {
  it('returns an empty object for a simple product', () => {
    expect(buildVariantOptions([])).toEqual({});
    expect(buildVariantOptions()).toEqual({});
  });

  it('maps attribute name to value text', () => {
    const actual = buildVariantOptions([
      { value: 'M', attribute: { name: 'Size' } },
      { value: 'Red', attribute: { name: 'Colour' } },
    ]);

    expect(actual).toEqual({ Size: 'M', Colour: 'Red' });
  });

  it('orders the keys by the attribute position the owner chose', () => {
    const actual = buildVariantOptions([
      { value: 'Red', attribute: { name: 'Colour', position: 1 } },
      { value: 'M', attribute: { name: 'Size', position: 0 } },
    ]);

    expect(Object.keys(actual)).toEqual(['Size', 'Colour']);
  });

  it('drops a value whose attribute did not load rather than keying it blank', () => {
    const actual = buildVariantOptions([
      { value: 'M', attribute: null },
      { value: 'Red', attribute: { name: 'Colour' } },
    ]);

    expect(actual).toEqual({ Colour: 'Red' });
  });

  it('does not mutate the array it was given', () => {
    const inputValues = [
      { value: 'Red', attribute: { name: 'Colour', position: 1 } },
      { value: 'M', attribute: { name: 'Size', position: 0 } },
    ];
    buildVariantOptions(inputValues);

    expect(inputValues[0].value).toBe('Red');
  });
});

describe('describeVariant', () => {
  it('names a simple product by its title alone', () => {
    expect(describeVariant({ title: 'Blue Mug', options: {} })).toBe(
      'Blue Mug',
    );
  });

  it('appends the options a shopper picked', () => {
    expect(describeVariant({ title: 'Blue Mug', options: { Size: 'M' } })).toBe(
      'Blue Mug — Size M',
    );
  });

  it('joins several options', () => {
    expect(
      describeVariant({
        title: 'T-Shirt',
        options: { Size: 'XL', Colour: 'Black' },
      }),
    ).toBe('T-Shirt — Size XL, Colour Black');
  });
});
