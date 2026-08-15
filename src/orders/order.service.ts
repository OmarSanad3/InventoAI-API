import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ProductVariant } from '../catalog/entities/product-variant.entity';
import { ProductService } from '../catalog/product.service';
import { Store } from '../site-builder/entities/store.entity';
import { StoreService } from '../site-builder/store.service';
import { OrderQueryDto } from './dto/order-query.dto';
import { UpdateOrderNoteDto } from './dto/update-order-note.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { OrderSort } from './enums/order-sort.enum';
import { OrderStatus } from './enums/order-status.enum';
import { PaymentMethod } from './enums/payment-method.enum';
import { PaymentStatus } from './enums/payment-status.enum';
import {
  ORDER_NUMBER_SEARCH_PATTERN,
  STOCK_RESTORING_STATUSES,
} from './orders.constants';
import { assertTransition } from './utils/order-transition.util';

/** What a status change needs to know, whoever asked for it. */
export interface ChangeStatusCommand {
  readonly order: Order;
  readonly status: OrderStatus;
  readonly reason?: string;
}

/**
 * Owns the `Order` row: the dashboard's reads, the owner's edits, and the one
 * place a status ever changes — the customer's cancel goes through the same
 * method, so the machine and the stock restore cannot be bypassed.
 */
@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly productService: ProductService,
    private readonly storeService: StoreService,
  ) {}

  /** The dashboard list, filtered and paginated. */
  async list(
    user: JwtPayload,
    query: OrderQueryDto,
  ): Promise<[Order[], number]> {
    const store = await this.storeService.resolveCallerStore(user);
    const builder = this.buildDashboardQuery(store.id, query)
      .leftJoinAndSelect('order.items', 'item')
      .orderBy(this.buildOrderColumn(query), query.order)
      .addOrderBy('order.orderNumber', 'DESC')
      .skip(query.offset)
      .take(query.limit);

    return builder.getManyAndCount();
  }

  async getById(user: JwtPayload, id: string): Promise<Order> {
    const store = await this.storeService.resolveCallerStore(user);
    return this.loadFull(store.id, { id });
  }

  /** The owner moving an order along, or calling it off. */
  async updateStatus(
    user: JwtPayload,
    id: string,
    dto: UpdateOrderStatusDto,
  ): Promise<Order> {
    const store = await this.storeService.resolveCallerStore(user);
    const order = await this.loadFull(store.id, { id });

    await this.changeStatus({
      order,
      status: dto.status,
      reason: dto.reason,
    });
    return this.loadFull(store.id, { id });
  }

  /** Owner-only, and never mapped onto a customer-facing DTO. */
  async updateNote(
    user: JwtPayload,
    id: string,
    dto: UpdateOrderNoteDto,
  ): Promise<Order> {
    const store = await this.storeService.resolveCallerStore(user);
    const order = await this.loadFull(store.id, { id });

    order.internalNote = dto.internalNote.trim() || null;
    await this.orderRepository.save(order);
    return this.loadFull(store.id, { id });
  }

  /**
   * **The only writer of `Order.status`.** Checks the machine, then applies the
   * two side effects that hang off it, in one transaction:
   *
   * - cancelling from `pending` or `confirmed` puts every line's stock back and
   *   recomputes the products' aggregates — once shipped, the goods have left;
   * - delivering a `cod` order marks it paid, which is the entire COD money
   *   story.
   */
  async changeStatus({
    order,
    status,
    reason,
  }: ChangeStatusCommand): Promise<void> {
    assertTransition({ from: order.status, to: status });

    await this.orderRepository.manager.transaction(async (manager) => {
      if (
        status === OrderStatus.Cancelled &&
        STOCK_RESTORING_STATUSES.includes(order.status)
      ) {
        await this.restoreStock(manager, order);
      }

      const changes: Partial<Order> = { status };
      if (status === OrderStatus.Cancelled) {
        changes.cancelledAt = new Date();
        changes.cancelReason = reason?.trim() || null;
      }
      if (
        status === OrderStatus.Delivered &&
        order.paymentMethod === PaymentMethod.Cod &&
        order.paymentStatus === PaymentStatus.Unpaid
      ) {
        changes.paymentStatus = PaymentStatus.Paid;
      }

      // Conditional on the status this call read. Two owners cancelling the
      // same order at once would otherwise both pass `assertTransition` and
      // both restore the stock; the loser affects zero rows here and the throw
      // rolls its restore back.
      const result = await manager.update(
        Order,
        { id: order.id, status: order.status },
        changes,
      );
      if (result.affected === 0) {
        throw new ConflictException(
          'This order changed while you were working on it — reload it',
        );
      }
    });
  }

  /**
   * One order with its lines. Addressed by `id` from the dashboard and by
   * `orderNumber` + `userId` from the storefront; an order outside the given
   * scope must look missing, never forbidden.
   */
  async loadFull(
    storeId: string,
    {
      id,
      orderNumber,
      userId,
    }: { id?: string; orderNumber?: number; userId?: string },
  ): Promise<Order> {
    const builder = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'item')
      .where('order.storeId = :storeId', { storeId })
      .orderBy('item.position', 'ASC');

    if (id !== undefined) {
      builder.andWhere('order.id = :id', { id });
    }
    if (orderNumber !== undefined) {
      builder.andWhere('order.orderNumber = :orderNumber', { orderNumber });
    }
    if (userId !== undefined) {
      builder.andWhere('order.userId = :userId', { userId });
    }

    const order = await builder.getOne();
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  /**
   * The store and the buyer a storefront order route acts for.
   *
   * `StoreScopeGuard` has already rejected a token issued for another store;
   * what is left to reject is the platform-level `OWNER`, who has no customer
   * account here — and a draft store, which `resolvePublicStore` 404s.
   */
  async resolveCustomerScope({
    user,
    slug,
  }: {
    user: JwtPayload;
    slug: string;
  }): Promise<{ store: Store; userId: string }> {
    const { store } = await this.storeService.resolvePublicStore(slug);
    if (user.storeId !== store.id) {
      throw new ForbiddenException(
        'This action requires a customer account on this store',
      );
    }
    return { store, userId: user.sub };
  }

  /** The storefront's own list, always narrowed to the caller's own rows. */
  buildCustomerQuery(
    storeId: string,
    userId: string,
  ): SelectQueryBuilder<Order> {
    return this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'item')
      .where('order.storeId = :storeId', { storeId })
      .andWhere('order.userId = :userId', { userId });
  }

  /**
   * Puts a cancelled order's units back on the shelf. Soft-deleted variants are
   * updated too: the product may be gone from the catalog, but the stock that
   * came off it is still real.
   */
  private async restoreStock(
    manager: EntityManager,
    order: Order,
  ): Promise<void> {
    const items = order.items ?? (await this.loadItems(manager, order.id));
    const productIds = new Set<string>();

    for (const item of items) {
      if (!item.variantId) {
        continue;
      }
      await manager
        .createQueryBuilder()
        .update(ProductVariant)
        .set({ stockQuantity: () => '"stockQuantity" + :quantity' })
        .where('id = :variantId')
        .setParameters({ variantId: item.variantId, quantity: item.quantity })
        .execute();

      if (item.productId) {
        productIds.add(item.productId);
      }
    }

    for (const productId of productIds) {
      await this.productService.recalculateAggregates(productId, manager);
    }
  }

  private async loadItems(
    manager: EntityManager,
    orderId: string,
  ): Promise<OrderItem[]> {
    return manager.find(OrderItem, {
      where: { orderId },
      order: { position: 'ASC' },
    });
  }

  private buildDashboardQuery(
    storeId: string,
    query: OrderQueryDto,
  ): SelectQueryBuilder<Order> {
    const builder = this.orderRepository
      .createQueryBuilder('order')
      .where('order.storeId = :storeId', { storeId });

    if (query.status) {
      builder.andWhere('order.status = :status', { status: query.status });
    }
    if (query.paymentStatus) {
      builder.andWhere('order.paymentStatus = :paymentStatus', {
        paymentStatus: query.paymentStatus,
      });
    }
    if (query.fromDate) {
      builder.andWhere('order.createdAt >= :fromDate', {
        fromDate: new Date(query.fromDate),
      });
    }
    if (query.toDate) {
      builder.andWhere('order.createdAt <= :toDate', {
        toDate: new Date(query.toDate),
      });
    }
    this.applySearch(builder, query.search);

    return builder;
  }

  /**
   * The owner looking for a row they know exists: the order number they were
   * given over the phone, or part of the buyer's name or email.
   */
  private applySearch(
    builder: SelectQueryBuilder<Order>,
    search: string | undefined,
  ): void {
    const term = search?.trim();
    if (!term) {
      return;
    }

    const asNumber = ORDER_NUMBER_SEARCH_PATTERN.exec(term);
    if (asNumber) {
      builder.andWhere('order.orderNumber = :orderNumber', {
        orderNumber: Number(asNumber[1]),
      });
      return;
    }

    builder.andWhere(
      '(order.contactName ILIKE :term OR order.contactEmail ILIKE :term)',
      { term: `%${term}%` },
    );
  }

  private buildOrderColumn(query: OrderQueryDto): string {
    const columns: Record<OrderSort, string> = {
      [OrderSort.CreatedAt]: 'order.createdAt',
      [OrderSort.TotalAmount]: 'order.totalAmount',
    };
    return columns[query.sort];
  }
}
