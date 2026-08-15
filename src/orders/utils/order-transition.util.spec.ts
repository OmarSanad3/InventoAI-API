import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '../enums/order-status.enum';
import { ORDER_STATUS_TRANSITIONS } from '../orders.constants';
import { assertTransition } from './order-transition.util';

const ALL_STATUSES = Object.values(OrderStatus);

describe('assertTransition', () => {
  it('accepts every edge the table declares', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ORDER_STATUS_TRANSITIONS[from]) {
        expect(() => assertTransition({ from, to })).not.toThrow();
      }
    }
  });

  it('rejects every edge the table does not declare', () => {
    for (const from of ALL_STATUSES) {
      const allowed = ORDER_STATUS_TRANSITIONS[from];
      for (const to of ALL_STATUSES.filter((status) => status !== from)) {
        if (allowed.includes(to)) {
          continue;
        }
        expect(() => assertTransition({ from, to })).toThrow(
          BadRequestException,
        );
      }
    }
  });

  it('walks the happy path end to end', () => {
    expect(() =>
      assertTransition({
        from: OrderStatus.Pending,
        to: OrderStatus.Confirmed,
      }),
    ).not.toThrow();
    expect(() =>
      assertTransition({
        from: OrderStatus.Confirmed,
        to: OrderStatus.Shipped,
      }),
    ).not.toThrow();
    expect(() =>
      assertTransition({
        from: OrderStatus.Shipped,
        to: OrderStatus.Delivered,
      }),
    ).not.toThrow();
  });

  it('rejects skipping a step, naming both states', () => {
    expect(() =>
      assertTransition({
        from: OrderStatus.Pending,
        to: OrderStatus.Delivered,
      }),
    ).toThrow('An order cannot go from pending to delivered');
  });

  it('rejects moving backwards', () => {
    expect(() =>
      assertTransition({
        from: OrderStatus.Shipped,
        to: OrderStatus.Confirmed,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects everything out of a terminal state', () => {
    for (const from of [OrderStatus.Delivered, OrderStatus.Cancelled]) {
      for (const to of ALL_STATUSES.filter((status) => status !== from)) {
        expect(() => assertTransition({ from, to })).toThrow(
          `${from} is final`,
        );
      }
    }
  });

  it('rejects a no-op transition with a message that says so', () => {
    expect(() =>
      assertTransition({ from: OrderStatus.Shipped, to: OrderStatus.Shipped }),
    ).toThrow('This order is already shipped');
  });

  it('allows cancelling from every non-terminal state', () => {
    for (const from of [
      OrderStatus.Pending,
      OrderStatus.Confirmed,
      OrderStatus.Shipped,
    ]) {
      expect(() =>
        assertTransition({ from, to: OrderStatus.Cancelled }),
      ).not.toThrow();
    }
  });
});
