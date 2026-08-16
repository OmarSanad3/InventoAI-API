import { buildVariantLabel } from './variant-label.util';

describe('buildVariantLabel', () => {
  it('names each option by its attribute', () => {
    const inputVariant = {
      attributeValues: [
        { value: 'M', attribute: { name: 'Size', position: 0 } },
        { value: 'Black', attribute: { name: 'Colour', position: 1 } },
      ],
    };

    expect(buildVariantLabel(inputVariant)).toBe('Size: M, Colour: Black');
  });

  it("keeps the owner's attribute order, not the array's", () => {
    const inputVariant = {
      attributeValues: [
        { value: 'Black', attribute: { name: 'Colour', position: 1 } },
        { value: 'M', attribute: { name: 'Size', position: 0 } },
      ],
    };

    expect(buildVariantLabel(inputVariant)).toBe('Size: M, Colour: Black');
  });

  it('is null for a simple product, whose title says it all', () => {
    expect(buildVariantLabel({ attributeValues: [] })).toBeNull();
    expect(buildVariantLabel({})).toBeNull();
  });
});
