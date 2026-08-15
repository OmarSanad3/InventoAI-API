import { DEFAULT_SHIPPING_FEE } from '../orders.constants';

/** One priced line: the unit price the server read, times how many were bought. */
export interface OrderTotalsLine {
  readonly unitAmount: number;
  readonly quantity: number;
}

export interface OrderTotals {
  /** `unitAmount * quantity` per line, in the order the lines were given. */
  readonly lineTotals: number[];
  readonly subtotalAmount: number;
  readonly shippingFee: number;
  readonly totalAmount: number;
}

/**
 * The order's arithmetic, in integer minor units and nothing else. Every amount
 * comes from the database at checkout time — a client never sends a price — and
 * the result is **stored**, so an order's total can never drift when the catalog
 * is repriced.
 *
 * A non-integer or negative input is a programming error rather than bad user
 * input: the DTOs already reject those, so reaching here means an amount was
 * built rather than read.
 */
export function calculateTotals({
  items,
  shippingFee = DEFAULT_SHIPPING_FEE,
}: {
  items: readonly OrderTotalsLine[];
  shippingFee?: number;
}): OrderTotals {
  assertMinorUnits(shippingFee, 'shippingFee');

  const lineTotals = items.map((item, index) => {
    assertMinorUnits(item.unitAmount, `items[${index}].unitAmount`);
    assertPositiveInteger(item.quantity, `items[${index}].quantity`);
    return item.unitAmount * item.quantity;
  });

  const subtotalAmount = lineTotals.reduce((sum, total) => sum + total, 0);
  return {
    lineTotals,
    subtotalAmount,
    shippingFee,
    totalAmount: subtotalAmount + shippingFee,
  };
}

function assertMinorUnits(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer of minor units`);
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
}
