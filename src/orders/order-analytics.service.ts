import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderItem } from './entities/order-item.entity';
import { OrderStatus } from './enums/order-status.enum';

/**
 * What sold, when, and for how much — the sales log the platform already had.
 *
 * It lives here rather than in the Advisor for one reason: the predicate that
 * decides what counts as a sale (`status <> 'cancelled'`) is an **orders rule**,
 * and a second copy of it in another module is a rule that can drift. The
 * Advisor asks this service what sold; it does not learn to recognise a sale.
 *
 * This is also why there is no `InventoryEvent` table. `order_items` already
 * carries the product, the variant, the quantity and the price it went out at,
 * and a table written beside it would be a second copy of the same truth with
 * its own way of going wrong. The day stock starts moving for a reason that is
 * *not* an order — a shipment received, breakage, a correction — is the day
 * that table becomes necessary, and that day arrives with the supplier feature.
 */

/** One variant's sales over one window. */
export interface VariantSales {
  variantId: string;
  productId: string;
  units: number;
  /** Minor units, at the price each order actually went out at. */
  revenueAmount: number;
}

/** One product's, summed across its variants. */
export interface ProductSales {
  productId: string;
  units: number;
  revenueAmount: number;
}

export interface SalesWindow {
  storeId: string;
  since: Date;
  /** Exclusive. Defaults to now, and is what makes two windows adjacent. */
  until?: Date;
}

@Injectable()
export class OrderAnalyticsService {
  constructor(
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
  ) {}

  /** Units and revenue per variant over the window. */
  async sumSalesByVariant({
    storeId,
    since,
    until,
  }: SalesWindow): Promise<VariantSales[]> {
    const rows = await this.buildSalesQuery({ storeId, since, until })
      .select('item.variantId', 'variantId')
      .addSelect('item.productId', 'productId')
      .addSelect('SUM(item.quantity)', 'units')
      .addSelect('SUM(item.lineTotalAmount)', 'revenueAmount')
      .andWhere('item.variantId IS NOT NULL')
      .groupBy('item.variantId')
      .addGroupBy('item.productId')
      .getRawMany<{
        variantId: string;
        productId: string | null;
        units: string;
        revenueAmount: string;
      }>();

    return rows.map((row) => ({
      variantId: row.variantId,
      productId: row.productId ?? '',
      units: Number(row.units),
      revenueAmount: Number(row.revenueAmount),
    }));
  }

  /** The same, per product — what an owner actually reorders. */
  async sumSalesByProduct({
    storeId,
    since,
    until,
  }: SalesWindow): Promise<ProductSales[]> {
    const rows = await this.buildSalesQuery({ storeId, since, until })
      .select('item.productId', 'productId')
      .addSelect('SUM(item.quantity)', 'units')
      .addSelect('SUM(item.lineTotalAmount)', 'revenueAmount')
      .andWhere('item.productId IS NOT NULL')
      .groupBy('item.productId')
      .getRawMany<{
        productId: string;
        units: string;
        revenueAmount: string;
      }>();

    return rows.map((row) => ({
      productId: row.productId,
      units: Number(row.units),
      revenueAmount: Number(row.revenueAmount),
    }));
  }

  /**
   * When each product last sold, over all time.
   *
   * Deliberately unwindowed: "nothing has sold in 45 days" is a claim about
   * every order ever placed, and a windowed query could only ever say "nothing
   * sold inside the window I looked at".
   */
  async findLastSoldAtByProduct(storeId: string): Promise<Map<string, Date>> {
    const rows = await this.orderItemRepository
      .createQueryBuilder('item')
      .innerJoin('item.order', 'order')
      .where('order.storeId = :storeId', { storeId })
      .andWhere('order.status <> :cancelled', {
        cancelled: OrderStatus.Cancelled,
      })
      .andWhere('item.productId IS NOT NULL')
      .select('item.productId', 'productId')
      .addSelect('MAX(order.createdAt)', 'lastSoldAt')
      .groupBy('item.productId')
      .getRawMany<{ productId: string; lastSoldAt: Date }>();

    return new Map(rows.map((row) => [row.productId, row.lastSoldAt]));
  }

  /**
   * The one predicate that defines a sale, written once.
   *
   * A cancelled order restored its stock and took no money, so counting it
   * would tell an owner to reorder something nobody bought. Every other status
   * — pending, confirmed, shipped, delivered — is demand that happened.
   */
  private buildSalesQuery({ storeId, since, until }: SalesWindow) {
    const builder = this.orderItemRepository
      .createQueryBuilder('item')
      .innerJoin('item.order', 'order')
      .where('order.storeId = :storeId', { storeId })
      .andWhere('order.status <> :cancelled', {
        cancelled: OrderStatus.Cancelled,
      })
      .andWhere('order.createdAt >= :since', { since });

    if (until) {
      builder.andWhere('order.createdAt < :until', { until });
    }

    return builder;
  }
}
