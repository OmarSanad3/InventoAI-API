import { SupplierOffer } from '../entities/supplier-offer.entity';
import { OfferExtractionStatus } from '../enums/offer-extraction-status.enum';
import { SupplierOfferStatus } from '../enums/supplier-offer-status.enum';
import type { OfferRanking } from '../utils/rank-offers.util';

/**
 * One row of the comparison table: what the supplier offered, and how it
 * compares.
 *
 * The ranking half is computed per read by `rankOffers` and stored nowhere —
 * it depends on the other offers, and every one of them can change. `rawReply`
 * is included because a failed extraction is exactly the case where the owner
 * needs to see what the supplier actually wrote.
 */
export class SupplierOfferDto {
  id!: string;
  supplierId!: string | null;
  supplierName!: string;
  supplierEmail!: string;
  status!: SupplierOfferStatus;
  /** Minor units, in the store's currency. */
  unitAmount!: number | null;
  quantity!: number | null;
  deliveryDays!: number | null;
  notes!: string | null;
  rawReply!: string | null;
  extractionStatus!: OfferExtractionStatus | null;
  sentAt!: Date | null;
  repliedAt!: Date | null;
  decidedAt!: Date | null;
  /** `unitAmount × quantity`. Derived, never stored. */
  totalAmount!: number | null;
  rank!: number | null;
  isRecommended!: boolean;
  isCheapest!: boolean;
  isFastest!: boolean;
  isLate!: boolean;
  createdAt!: Date;

  static fromEntity(
    offer: SupplierOffer,
    ranking: OfferRanking,
  ): SupplierOfferDto {
    const dto = new SupplierOfferDto();
    dto.id = offer.id;
    dto.supplierId = offer.supplierId;
    dto.supplierName = offer.supplierName;
    dto.supplierEmail = offer.supplierEmail;
    dto.status = offer.status;
    dto.unitAmount = offer.unitAmount;
    dto.quantity = offer.quantity;
    dto.deliveryDays = offer.deliveryDays;
    dto.notes = offer.notes;
    dto.rawReply = offer.rawReply;
    dto.extractionStatus = offer.extractionStatus;
    dto.sentAt = offer.sentAt;
    dto.repliedAt = offer.repliedAt;
    dto.decidedAt = offer.decidedAt;
    dto.totalAmount = ranking.totalAmount;
    dto.rank = ranking.rank;
    dto.isRecommended = ranking.isRecommended;
    dto.isCheapest = ranking.isCheapest;
    dto.isFastest = ranking.isFastest;
    dto.isLate = ranking.isLate;
    dto.createdAt = offer.createdAt;
    return dto;
  }
}
