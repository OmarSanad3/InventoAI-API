import { BadRequestException } from '@nestjs/common';
import { PurchaseRequestStatus } from '../enums/purchase-request-status.enum';
import { PURCHASE_REQUEST_TRANSITIONS } from '../suppliers.constants';

/**
 * The single place the request machine is enforced — send, cancel, the first
 * reply and confirm all go through it, so an illegal move is impossible rather
 * than merely unlikely.
 *
 * The 400 names **both** states, as `assertTransition` does for orders: "cannot
 * go from confirmed to cancelled" is a message a dashboard can show.
 */
export function assertRequestTransition({
  from,
  to,
}: {
  from: PurchaseRequestStatus;
  to: PurchaseRequestStatus;
}): void {
  if (from === to) {
    throw new BadRequestException(`This purchase request is already ${from}`);
  }

  const allowed = PURCHASE_REQUEST_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new BadRequestException(
      `A purchase request cannot go from ${from} to ${to}` +
        (allowed.length === 0
          ? `; ${from} is final`
          : ` — allowed next: ${allowed.join(', ')}`),
    );
  }
}
