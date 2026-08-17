import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  MAX_NEEDED_WITHIN_DAYS,
  MAX_RECIPIENTS_PER_REQUEST,
  MAX_REQUEST_QUANTITY,
  REQUEST_BODY_MAX_LENGTH,
  REQUEST_BODY_MIN_LENGTH,
  REQUEST_NOTE_MAX_LENGTH,
  REQUEST_SUBJECT_MAX_LENGTH,
  REQUEST_SUBJECT_MIN_LENGTH,
} from '../suppliers.constants';

/**
 * The owner's edit of the drafted email, and of who receives it. Accepted only
 * while the request is a draft — the service says so, because whether it is one
 * depends on the row rather than on the body.
 *
 * `variantId` is deliberately absent: the snapshot was taken when the request
 * was created, and changing the shelf under a drafted email is a new request.
 */
export class UpdatePurchaseRequestDto {
  @IsOptional()
  @IsString()
  @Length(REQUEST_SUBJECT_MIN_LENGTH, REQUEST_SUBJECT_MAX_LENGTH)
  subject?: string;

  @IsOptional()
  @IsString()
  @Length(REQUEST_BODY_MIN_LENGTH, REQUEST_BODY_MAX_LENGTH)
  body?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_REQUEST_QUANTITY)
  quantity?: number;

  @ValidateIf((dto: UpdatePurchaseRequestDto) => dto.neededWithinDays !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_NEEDED_WITHIN_DAYS)
  neededWithinDays?: number | null;

  @ValidateIf((dto: UpdatePurchaseRequestDto) => dto.note !== null)
  @IsOptional()
  @IsString()
  @MaxLength(REQUEST_NOTE_MAX_LENGTH)
  note?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECIPIENTS_PER_REQUEST)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  supplierIds?: string[];
}
