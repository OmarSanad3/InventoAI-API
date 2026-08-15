import { IsString, Length } from 'class-validator';
import { MAX_INTERNAL_NOTE_LENGTH } from '../orders.constants';

/**
 * The owner's private note on an order. An empty string clears it. It never
 * reaches a customer route — that is why `OrderDetailDto` and `OrderResponseDto`
 * are two classes rather than one with a flag.
 */
export class UpdateOrderNoteDto {
  @IsString()
  @Length(0, MAX_INTERNAL_NOTE_LENGTH)
  internalNote!: string;
}
