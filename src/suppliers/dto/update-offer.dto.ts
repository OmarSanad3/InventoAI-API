import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  MAX_OFFER_DELIVERY_DAYS,
  MAX_OFFER_UNIT_PRICE,
  MAX_REQUEST_QUANTITY,
  MINOR_UNITS_PER_MAJOR,
  OFFER_NOTES_MAX_LENGTH,
} from '../suppliers.constants';

/**
 * The owner's own reading of a reply — what fixes a failed extraction, and what
 * corrects a model that picked the wrong number out of two.
 *
 * `unitAmount` is in **minor units**, like every other amount this API accepts
 * and returns. The dashboard multiplies what the owner typed; the model's path
 * converts in `sanitizeExtractedOffer`. Nothing in this codebase stores a
 * decimal price.
 */
export class UpdateOfferDto {
  @ValidateIf((dto: UpdateOfferDto) => dto.unitAmount !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_OFFER_UNIT_PRICE * MINOR_UNITS_PER_MAJOR)
  unitAmount?: number | null;

  @ValidateIf((dto: UpdateOfferDto) => dto.quantity !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_REQUEST_QUANTITY)
  quantity?: number | null;

  @ValidateIf((dto: UpdateOfferDto) => dto.deliveryDays !== null)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_OFFER_DELIVERY_DAYS)
  deliveryDays?: number | null;

  @ValidateIf((dto: UpdateOfferDto) => dto.notes !== null)
  @IsOptional()
  @IsString()
  @MaxLength(OFFER_NOTES_MAX_LENGTH)
  notes?: string | null;
}
