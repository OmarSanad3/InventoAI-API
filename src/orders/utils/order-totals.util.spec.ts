import { calculateTotals } from './order-totals.util';

describe('calculateTotals', () => {
  it('returns zeroes for an empty cart', () => {
    const actual = calculateTotals({ items: [] });

    expect(actual).toEqual({
      lineTotals: [],
      subtotalAmount: 0,
      shippingFee: 0,
      totalAmount: 0,
    });
  });

  it('multiplies a single line by its quantity', () => {
    const actual = calculateTotals({
      items: [{ unitAmount: 24900, quantity: 3 }],
    });

    expect(actual.lineTotals).toEqual([74700]);
    expect(actual.subtotalAmount).toBe(74700);
    expect(actual.totalAmount).toBe(74700);
  });

  it('sums many lines and keeps them in the order given', () => {
    const actual = calculateTotals({
      items: [
        { unitAmount: 24900, quantity: 2 },
        { unitAmount: 1, quantity: 7 },
        { unitAmount: 999, quantity: 1 },
      ],
    });

    expect(actual.lineTotals).toEqual([49800, 7, 999]);
    expect(actual.subtotalAmount).toBe(50806);
  });

  it('adds the shipping fee to the total but not to the subtotal', () => {
    const actual = calculateTotals({
      items: [{ unitAmount: 5000, quantity: 2 }],
      shippingFee: 2500,
    });

    expect(actual.subtotalAmount).toBe(10000);
    expect(actual.shippingFee).toBe(2500);
    expect(actual.totalAmount).toBe(12500);
  });

  it('accepts a free line — a zero price is not the same as a missing one', () => {
    const actual = calculateTotals({ items: [{ unitAmount: 0, quantity: 4 }] });

    expect(actual.totalAmount).toBe(0);
  });

  it('stays exact where floating-point money would not', () => {
    const actual = calculateTotals({
      items: Array.from({ length: 10 }, () => ({
        unitAmount: 10,
        quantity: 1,
      })),
    });

    expect(actual.subtotalAmount).toBe(100);
  });

  it('rejects a fractional amount', () => {
    expect(() =>
      calculateTotals({ items: [{ unitAmount: 249.5, quantity: 1 }] }),
    ).toThrow('items[0].unitAmount');
  });

  it('rejects a negative amount', () => {
    expect(() =>
      calculateTotals({ items: [{ unitAmount: -100, quantity: 1 }] }),
    ).toThrow('items[0].unitAmount');
  });

  it('rejects a quantity below one', () => {
    expect(() =>
      calculateTotals({ items: [{ unitAmount: 100, quantity: 0 }] }),
    ).toThrow('items[0].quantity');
  });

  it('rejects a negative shipping fee', () => {
    expect(() => calculateTotals({ items: [], shippingFee: -1 })).toThrow(
      'shippingFee',
    );
  });
});
