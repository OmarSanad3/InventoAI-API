import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { OrderStatus } from '../enums/order-status.enum';
import { MAX_CANCEL_REASON_LENGTH } from '../orders.constants';

/**
 * The owner moving an order along. The move itself is checked against
 * `ORDER_STATUS_TRANSITIONS`, so an illegal one is a 400 naming both states
 * rather than a silent write.
 */
export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  /** Recorded only when the new status is `cancelled`. */
  @IsOptional()
  @IsString()
  @Length(0, MAX_CANCEL_REASON_LENGTH)
  reason?: string;
}
