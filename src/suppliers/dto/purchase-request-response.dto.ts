import { PurchaseRequest } from '../entities/purchase-request.entity';
import { DraftStatus } from '../enums/draft-status.enum';
import { PurchaseRequestStatus } from '../enums/purchase-request-status.enum';
import { SupplierOfferStatus } from '../enums/supplier-offer-status.enum';

/**
 * A request as the list shows it: what is being bought, where it is in the
 * machine, and how many suppliers have answered.
 *
 * `storeId` is omitted, as everywhere else. The detail DTO extends this one, so
 * a field added here appears in both — which is the safe direction.
 */
export class PurchaseRequestResponseDto {
  id!: string;
  productId!: string | null;
  variantId!: string | null;
  productTitle!: string;
  variantLabel!: string | null;
  quantity!: number;
  neededWithinDays!: number | null;
  subject!: string;
  body!: string;
  note!: string | null;
  status!: PurchaseRequestStatus;
  /** Whether the model or the template wrote `body`. */
  draftStatus!: DraftStatus;
  offerCount!: number;
  /** How many suppliers have actually answered. */
  receivedCount!: number;
  sentAt!: Date | null;
  confirmedAt!: Date | null;
  confirmedOfferId!: string | null;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(request: PurchaseRequest): PurchaseRequestResponseDto {
    return fill(new PurchaseRequestResponseDto(), request);
  }
}

/** Shared by both DTOs, so the detail view can never drift from the list. */
export function fill<T extends PurchaseRequestResponseDto>(
  dto: T,
  request: PurchaseRequest,
): T {
  const offers = request.offers ?? [];

  dto.id = request.id;
  dto.productId = request.productId;
  dto.variantId = request.variantId;
  dto.productTitle = request.productTitle;
  dto.variantLabel = request.variantLabel;
  dto.quantity = request.quantity;
  dto.neededWithinDays = request.neededWithinDays;
  dto.subject = request.subject;
  dto.body = request.body;
  dto.note = request.note;
  dto.status = request.status;
  dto.draftStatus = request.draftStatus;
  dto.offerCount = offers.length;
  dto.receivedCount = offers.filter(
    (offer) => offer.status !== SupplierOfferStatus.Awaiting,
  ).length;
  dto.sentAt = request.sentAt;
  dto.confirmedAt = request.confirmedAt;
  dto.confirmedOfferId = request.confirmedOfferId;
  dto.createdAt = request.createdAt;
  dto.updatedAt = request.updatedAt;
  return dto;
}
