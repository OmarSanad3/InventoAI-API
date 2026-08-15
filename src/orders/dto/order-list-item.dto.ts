import { Order } from '../entities/order.entity';
import { OrderStatus } from '../enums/order-status.enum';
import { PaymentMethod } from '../enums/payment-method.enum';
import { PaymentStatus } from '../enums/payment-status.enum';

/**
 * One row of an order table — the dashboard's and the customer's alike. Lines
 * are summarised into `itemCount` rather than shipped whole: a page of 20 orders
 * would otherwise carry hundreds of line objects nobody renders.
 */
export class OrderListItemDto {
  id!: string;
  orderNumber!: number;
  status!: OrderStatus;
  paymentStatus!: PaymentStatus;
  paymentMethod!: PaymentMethod;
  currency!: string;
  totalAmount!: number;
  /** Distinct lines, not units — "3 items" means three products. */
  itemCount!: number;
  contactName!: string;
  contactEmail!: string;
  createdAt!: Date;

  static fromEntity(order: Order): OrderListItemDto {
    const dto = new OrderListItemDto();
    dto.id = order.id;
    dto.orderNumber = order.orderNumber;
    dto.status = order.status;
    dto.paymentStatus = order.paymentStatus;
    dto.paymentMethod = order.paymentMethod;
    dto.currency = order.currency;
    dto.totalAmount = order.totalAmount;
    dto.itemCount = (order.items ?? []).length;
    dto.contactName = order.contactName;
    dto.contactEmail = order.contactEmail;
    dto.createdAt = order.createdAt;
    return dto;
  }
}
