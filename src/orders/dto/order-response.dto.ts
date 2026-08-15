import { Order } from '../entities/order.entity';
import { OrderStatus } from '../enums/order-status.enum';
import { PaymentMethod } from '../enums/payment-method.enum';
import { PaymentStatus } from '../enums/payment-status.enum';
import type { ShippingAddress } from '../types/shipping-address';
import { OrderItemDto } from './order-item.dto';

/**
 * The customer's view of their own order.
 *
 * `internalNote` is **absent by construction** rather than conditionally
 * omitted: a field that is sometimes returned is how an owner's private note
 * eventually reaches the buyer. The dashboard has `OrderDetailDto` for that.
 */
export class OrderResponseDto {
  id!: string;
  orderNumber!: number;
  status!: OrderStatus;
  paymentStatus!: PaymentStatus;
  paymentMethod!: PaymentMethod;
  currency!: string;
  subtotalAmount!: number;
  shippingFee!: number;
  totalAmount!: number;
  contactName!: string;
  contactEmail!: string;
  contactPhone!: string;
  shippingAddress!: ShippingAddress;
  customerNote!: string | null;
  cancelledAt!: Date | null;
  cancelReason!: string | null;
  items!: OrderItemDto[];
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(order: Order): OrderResponseDto {
    const dto = new OrderResponseDto();
    dto.id = order.id;
    dto.orderNumber = order.orderNumber;
    dto.status = order.status;
    dto.paymentStatus = order.paymentStatus;
    dto.paymentMethod = order.paymentMethod;
    dto.currency = order.currency;
    dto.subtotalAmount = order.subtotalAmount;
    dto.shippingFee = order.shippingFee;
    dto.totalAmount = order.totalAmount;
    dto.contactName = order.contactName;
    dto.contactEmail = order.contactEmail;
    dto.contactPhone = order.contactPhone;
    dto.shippingAddress = order.shippingAddress;
    dto.customerNote = order.customerNote;
    dto.cancelledAt = order.cancelledAt;
    dto.cancelReason = order.cancelReason;
    dto.items = (order.items ?? []).map((item) =>
      OrderItemDto.fromEntity(item),
    );
    dto.createdAt = order.createdAt;
    dto.updatedAt = order.updatedAt;
    return dto;
  }
}
