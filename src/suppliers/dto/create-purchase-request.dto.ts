import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_NEEDED_WITHIN_DAYS,
  MAX_RECIPIENTS_PER_REQUEST,
  MAX_REQUEST_QUANTITY,
  REQUEST_NOTE_MAX_LENGTH,
} from '../suppliers.constants';

/**
 * What the owner picks: a shelf, a quantity and who to ask.
 *
 * `variantId` rather than `productId`, because stock is per variant — a request
 * for "the abaya" when three sizes are running out separately is a request
 * nobody can quote. The Advisor's restock insight already carries the variant
 * id and a recommended quantity, which is what the dashboard's "reorder" button
 * posts here.
 */
export class CreatePurchaseRequestDto {
  @IsUUID()
  variantId!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_REQUEST_QUANTITY)
  quantity!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECIPIENTS_PER_REQUEST)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  supplierIds!: string[];

  /** The deadline an offer is judged against. Omitted means none. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_NEEDED_WITHIN_DAYS)
  neededWithinDays?: number;

  /** The owner's steer for the draft — "ask about bulk pricing". */
  @IsOptional()
  @IsString()
  @MaxLength(REQUEST_NOTE_MAX_LENGTH)
  note?: string;
}
