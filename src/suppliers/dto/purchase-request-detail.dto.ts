import { PurchaseRequest } from '../entities/purchase-request.entity';
import { rankOffers } from '../utils/rank-offers.util';
import {
  fill,
  PurchaseRequestResponseDto,
} from './purchase-request-response.dto';
import { SupplierOfferDto } from './supplier-offer.dto';

/**
 * The request with its offers, ranked — the side-by-side comparison the owner
 * picks from.
 *
 * The ranking is computed here, on every read, because it is a property of the
 * **set**: one reply arriving changes where every other offer stands. Storing
 * it would be storing a number with no single writer.
 */
export class PurchaseRequestDetailDto extends PurchaseRequestResponseDto {
  offers!: SupplierOfferDto[];

  static fromEntity(request: PurchaseRequest): PurchaseRequestDetailDto {
    const dto = fill(new PurchaseRequestDetailDto(), request);
    const offers = request.offers ?? [];

    const rankings = rankOffers({
      offers,
      requestedQuantity: request.quantity,
      neededWithinDays: request.neededWithinDays,
    });

    dto.offers = [...offers]
      .map((offer) =>
        SupplierOfferDto.fromEntity(
          offer,
          rankings.get(offer.id) ?? {
            totalAmount: null,
            rank: null,
            isRecommended: false,
            isCheapest: false,
            isFastest: false,
            isLate: false,
          },
        ),
      )
      // Best deal first, and the unranked rows after it in the order they were
      // asked — the table reads top-down as "take this one".
      .sort(byRankThenAge);

    return dto;
  }
}

function byRankThenAge(a: SupplierOfferDto, b: SupplierOfferDto): number {
  if (a.rank !== null && b.rank !== null) {
    return a.rank - b.rank;
  }
  if (a.rank !== null) {
    return -1;
  }
  if (b.rank !== null) {
    return 1;
  }
  return a.createdAt.getTime() - b.createdAt.getTime();
}
