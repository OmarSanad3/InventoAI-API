import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '../enums/order-status.enum';
import { ORDER_STATUS_TRANSITIONS } from '../orders.constants';

/**
 * The single place the status machine is enforced. Both the owner's
 * `PATCH /orders/:id/status` and the customer's cancel go through it, so an
 * illegal move is impossible rather than merely unlikely.
 *
 * The 400 names **both** states: "cannot go from pending to delivered" is a
 * message a dashboard can show, unlike "invalid status".
 */
export function assertTransition({
  from,
  to,
}: {
  from: OrderStatus;
  to: OrderStatus;
}): void {
  if (from === to) {
    throw new BadRequestException(`This order is already ${from}`);
  }

  const allowed = ORDER_STATUS_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new BadRequestException(
      `An order cannot go from ${from} to ${to}` +
        (allowed.length === 0
          ? `; ${from} is final`
          : ` — allowed next: ${allowed.join(', ')}`),
    );
  }
}
