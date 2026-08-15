import { IsOptional, IsString, Length } from 'class-validator';
import { MAX_CANCEL_REASON_LENGTH } from '../orders.constants';

/** Why the order was called off. Optional — most customers just change their mind. */
export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @Length(0, MAX_CANCEL_REASON_LENGTH)
  reason?: string;
}
