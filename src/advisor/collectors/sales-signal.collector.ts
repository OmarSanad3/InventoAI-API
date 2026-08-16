import { Injectable } from '@nestjs/common';
import { ProductService } from '../../catalog/product.service';
import { OrderAnalyticsService } from '../../orders/order-analytics.service';
import {
  SLOW_MOVER_DAYS,
  SLOW_MOVER_MIN_VALUE,
  VELOCITY_BASELINE_DAYS,
  VELOCITY_RECENT_DAYS,
} from '../advisor.constants';
import { AdvisorInsightKind } from '../enums/advisor-insight-kind.enum';
import { AdvisorSeverity } from '../enums/advisor-severity.enum';
import type { AdvisorSignal } from '../types/advisor-signal.type';
import { daysBetween, subtractDays } from '../utils/timezone.util';
import { detectTrending } from '../utils/velocity.util';
import type {
  CollectorContext,
  SignalCollector,
} from './signal-collector.interface';

/** A product's stock and what it is worth, summed from its variants. */
interface ProductStock {
  productId: string;
  productTitle: string;
  stockQuantity: number;
  tiedUpAmount: number;
}

/**
 * The two ends of the same question: what is moving, and what is not.
 *
 * `trending` is per **product** rather than per variant — an owner promotes a
 * product, and "size M is up 3×" is a fact about a shelf, not about demand.
 *
 * Neither half is a forecast. This is one rate compared to another rate, which
 * is what six weeks of orders can honestly support; the naming keeps it from
 * being mistaken for anything more.
 */
@Injectable()
export class SalesSignalCollector implements SignalCollector {
  readonly name = 'sales';

  constructor(
    private readonly productService: ProductService,
    private readonly orderAnalytics: OrderAnalyticsService,
  ) {}

  async collect({ store, now }: CollectorContext): Promise<AdvisorSignal[]> {
    const recentSince = subtractDays(now, VELOCITY_RECENT_DAYS);
    const baselineSince = subtractDays(
      now,
      VELOCITY_RECENT_DAYS + VELOCITY_BASELINE_DAYS,
    );

    const [recentSales, baselineSales, lastSoldAt, stockLevels] =
      await Promise.all([
        this.orderAnalytics.sumSalesByProduct({
          storeId: store.id,
          since: recentSince,
        }),
        // Adjacent, not overlapping: `until` is the recent window's `since`.
        this.orderAnalytics.sumSalesByProduct({
          storeId: store.id,
          since: baselineSince,
          until: recentSince,
        }),
        this.orderAnalytics.findLastSoldAtByProduct(store.id),
        this.productService.listStockLevels(store.id),
      ]);

    const stockByProduct = summariseStock(stockLevels);
    const baselineByProduct = new Map(
      baselineSales.map((sale) => [sale.productId, sale]),
    );

    return [
      ...this.findTrending({ recentSales, baselineByProduct, stockByProduct }),
      ...this.findSlowMovers({ stockByProduct, lastSoldAt, now }),
    ];
  }

  private findTrending({
    recentSales,
    baselineByProduct,
    stockByProduct,
  }: {
    recentSales: Awaited<
      ReturnType<OrderAnalyticsService['sumSalesByProduct']>
    >;
    baselineByProduct: Map<string, { units: number; revenueAmount: number }>;
    stockByProduct: Map<string, ProductStock>;
  }): AdvisorSignal[] {
    const signals: AdvisorSignal[] = [];

    for (const sale of recentSales) {
      const product = stockByProduct.get(sale.productId);
      // A product that no longer has a sellable variant — archived, drafted or
      // deleted since the order — is history, not advice.
      if (!product) {
        continue;
      }

      const baselineUnits = baselineByProduct.get(sale.productId)?.units ?? 0;
      const verdict = detectTrending({
        recentUnits: sale.units,
        recentDays: VELOCITY_RECENT_DAYS,
        baselineUnits,
        baselineDays: VELOCITY_BASELINE_DAYS,
      });
      if (!verdict.isTrending) {
        continue;
      }

      signals.push({
        kind: AdvisorInsightKind.Trending,
        severity: AdvisorSeverity.Info,
        dedupeKey: `trending:${sale.productId}`,
        impactAmount: sale.revenueAmount,
        payload: {
          productId: sale.productId,
          productTitle: product.productTitle,
          recentUnits: sale.units,
          baselineUnits,
          ratio:
            verdict.ratio === null ? null : Math.round(verdict.ratio * 10) / 10,
        },
      });
    }

    return signals;
  }

  private findSlowMovers({
    stockByProduct,
    lastSoldAt,
    now,
  }: {
    stockByProduct: Map<string, ProductStock>;
    lastSoldAt: Map<string, Date>;
    now: Date;
  }): AdvisorSignal[] {
    const signals: AdvisorSignal[] = [];

    for (const product of stockByProduct.values()) {
      if (product.stockQuantity <= 0) {
        continue;
      }
      // Cash worth a sentence. Below this it is a curiosity, not advice.
      if (product.tiedUpAmount < SLOW_MOVER_MIN_VALUE) {
        continue;
      }

      const soldAt = lastSoldAt.get(product.productId);
      const daysSinceLastSale = soldAt ? daysBetween(soldAt, now) : null;
      if (daysSinceLastSale !== null && daysSinceLastSale < SLOW_MOVER_DAYS) {
        continue;
      }

      signals.push({
        kind: AdvisorInsightKind.SlowMover,
        severity: AdvisorSeverity.Info,
        dedupeKey: `slow_mover:${product.productId}`,
        impactAmount: product.tiedUpAmount,
        payload: {
          productId: product.productId,
          productTitle: product.productTitle,
          stockQuantity: product.stockQuantity,
          tiedUpAmount: product.tiedUpAmount,
          daysSinceLastSale,
        },
      });
    }

    return signals;
  }
}

/** Variants up to the product an owner actually merchandises. */
function summariseStock(
  levels: Awaited<ReturnType<ProductService['listStockLevels']>>,
): Map<string, ProductStock> {
  const summary = new Map<string, ProductStock>();

  for (const level of levels) {
    const existing = summary.get(level.productId);
    const stockQuantity = Math.max(0, level.stockQuantity);
    const value = stockQuantity * level.priceAmount;

    if (existing) {
      existing.stockQuantity += stockQuantity;
      existing.tiedUpAmount += value;
      continue;
    }

    summary.set(level.productId, {
      productId: level.productId,
      productTitle: level.productTitle,
      stockQuantity,
      tiedUpAmount: value,
    });
  }

  return summary;
}
