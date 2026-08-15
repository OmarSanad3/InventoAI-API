import { BadRequestException, Injectable } from '@nestjs/common';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { Order } from './entities/order.entity';
import { OrderStatus } from './enums/order-status.enum';
import { OrderService } from './order.service';
import { CUSTOMER_CANCELLABLE_STATUSES } from './orders.constants';

/**
 * The storefront half of orders: a customer reading and cancelling their **own**
 * rows.
 *
 * Every query filters by `userId` on top of the store scope. `StoreScopeGuard`
 * says nothing about which customer of store A is asking, so without that filter
 * one customer could read another's order by guessing an order number.
 */
@Injectable()
export class CustomerOrderService {
  constructor(private readonly orderService: OrderService) {}

  async listMine(
    user: JwtPayload,
    slug: string,
    query: PaginationQueryDto,
  ): Promise<[Order[], number]> {
    const { store, userId } = await this.orderService.resolveCustomerScope({
      user,
      slug,
    });

    return this.orderService
      .buildCustomerQuery(store.id, userId)
      .orderBy('order.orderNumber', 'DESC')
      .skip(query.offset)
      .take(query.limit)
      .getManyAndCount();
  }

  /**
   * Addressed by `orderNumber` rather than `id` — it is the number in the
   * customer's confirmation, and being per-store it leaks nothing global.
   */
  async getMine(
    user: JwtPayload,
    slug: string,
    orderNumber: number,
  ): Promise<Order> {
    const { store, userId } = await this.orderService.resolveCustomerScope({
      user,
      slug,
    });
    return this.orderService.loadFull(store.id, { orderNumber, userId });
  }

  /**
   * A customer may call off their own order only while it is `pending`. Once the
   * owner has confirmed it they have to ask the owner, who can still cancel it
   * from the dashboard.
   */
  async cancelMine(
    user: JwtPayload,
    slug: string,
    orderNumber: number,
    dto: CancelOrderDto,
  ): Promise<Order> {
    const { store, userId } = await this.orderService.resolveCustomerScope({
      user,
      slug,
    });
    const order = await this.orderService.loadFull(store.id, {
      orderNumber,
      userId,
    });

    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status)) {
      throw new BadRequestException(
        `This order is already ${order.status} — ask the store to cancel it`,
      );
    }

    await this.orderService.changeStatus({
      order,
      status: OrderStatus.Cancelled,
      reason: dto.reason,
    });
    return this.orderService.loadFull(store.id, { orderNumber, userId });
  }
}
