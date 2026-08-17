import { hasAnyField, sanitizeExtractedOffer } from './sanitize-offer.util';

describe('sanitizeExtractedOffer', () => {
  it('converts a major-unit price into minor units', () => {
    const actual = sanitizeExtractedOffer({ unitPrice: 249 });

    expect(actual.unitAmount).toBe(24_900);
  });

  it('keeps the piastres of a fractional price', () => {
    const actual = sanitizeExtractedOffer({ unitPrice: 12.55 });

    expect(actual.unitAmount).toBe(1_255);
  });

  it('rounds a price with more precision than the currency has', () => {
    const actual = sanitizeExtractedOffer({ unitPrice: 10.999 });

    expect(actual.unitAmount).toBe(1_100);
  });

  it('accepts the numeric string a model returns despite the schema', () => {
    const actual = sanitizeExtractedOffer({
      unitPrice: ' 249.50 ',
      quantity: '100',
      deliveryDays: '7',
    });

    expect(actual).toMatchObject({
      unitAmount: 24_950,
      quantity: 100,
      deliveryDays: 7,
    });
  });

  it('drops a price large enough to be a misread rather than a product', () => {
    const actual = sanitizeExtractedOffer({ unitPrice: 20_000_000 });

    expect(actual.unitAmount).toBeNull();
  });

  it('drops a zero or negative price', () => {
    expect(sanitizeExtractedOffer({ unitPrice: 0 }).unitAmount).toBeNull();
    expect(sanitizeExtractedOffer({ unitPrice: -5 }).unitAmount).toBeNull();
  });

  it('drops a fractional quantity or delivery time', () => {
    const actual = sanitizeExtractedOffer({
      quantity: 10.5,
      deliveryDays: 2.5,
    });

    expect(actual.quantity).toBeNull();
    expect(actual.deliveryDays).toBeNull();
  });

  it('accepts same-day delivery but not a negative one', () => {
    expect(sanitizeExtractedOffer({ deliveryDays: 0 }).deliveryDays).toBe(0);
    expect(
      sanitizeExtractedOffer({ deliveryDays: -1 }).deliveryDays,
    ).toBeNull();
  });

  it('drops a delivery time beyond a year', () => {
    expect(
      sanitizeExtractedOffer({ deliveryDays: 400 }).deliveryDays,
    ).toBeNull();
  });

  it('keeps the fields it could read and nulls the ones it could not', () => {
    const actual = sanitizeExtractedOffer({
      unitPrice: 100,
      quantity: null,
      deliveryDays: 'next week',
      notes: '  bulk discount over 500  ',
    });

    expect(actual).toEqual({
      unitAmount: 10_000,
      quantity: null,
      deliveryDays: null,
      notes: 'bulk discount over 500',
    });
  });

  it('survives a response that is not an object at all', () => {
    expect(sanitizeExtractedOffer(null)).toEqual({
      unitAmount: null,
      quantity: null,
      deliveryDays: null,
      notes: null,
    });
  });

  it('treats an empty note as no note', () => {
    expect(sanitizeExtractedOffer({ notes: '   ' }).notes).toBeNull();
  });
});

describe('hasAnyField', () => {
  it('is true when a price was read', () => {
    expect(hasAnyField(sanitizeExtractedOffer({ unitPrice: 10 }))).toBe(true);
  });

  it('is true when only a delivery time was read', () => {
    expect(hasAnyField(sanitizeExtractedOffer({ deliveryDays: 3 }))).toBe(true);
  });

  it('is false when the model returned nothing but prose', () => {
    expect(
      hasAnyField(sanitizeExtractedOffer({ notes: 'we will get back' })),
    ).toBe(false);
  });
});
