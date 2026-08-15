import { Order } from '../entities/order.entity';
import { OrderResponseDto } from './order-response.dto';

/**
 * The dashboard's view: everything the customer sees, plus the owner-only
 * fields. Extending `OrderResponseDto` rather than duplicating it keeps the two
 * from drifting, and the direction is the safe one — a field added here can
 * never leak onto a customer route.
 */
export class OrderDetailDto extends OrderResponseDto {
  internalNote!: string | null;
  /** Null once the buyer's account is gone; the contact snapshot still renders. */
  userId!: string | null;

  static fromEntity(order: Order): OrderDetailDto {
    const dto = Object.assign(
      new OrderDetailDto(),
      OrderResponseDto.fromEntity(order),
    );
    dto.internalNote = order.internalNote;
    dto.userId = order.userId;
    return dto;
  }
}
