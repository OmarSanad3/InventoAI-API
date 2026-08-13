import { BadRequestException } from '@nestjs/common';

/**
 * A "was" price at or below the current price is a lie, not a discount.
 *
 * Checked against the **merged** values rather than in the DTO, because a patch
 * that touches only one of the two still has to hold against the other.
 */
export function assertComparePrice(
  priceAmount: number,
  compareAtAmount: number | null,
): void {
  if (compareAtAmount !== null && compareAtAmount <= priceAmount) {
    throw new BadRequestException(
      'compareAtAmount must be higher than priceAmount',
    );
  }
}
