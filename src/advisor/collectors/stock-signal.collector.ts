import { Injectable } from '@nestjs/common';
import { ProductService } from '../../catalog/product.service';
import { OrderAnalyticsService } from '../../orders/order-analytics.service';
import { VELOCITY_RECENT_DAYS } from '../advisor.constants';
import { AdvisorInsightKind } from '../enums/advisor-insight-kind.enum';
import { AdvisorSeverity } from '../enums/advisor-severity.enum';
import type { AdvisorSignal } from '../types/advisor-signal.type';
import { calculateVelocity, recommendRestock } from '../utils/velocity.util';
import { subtractDays } from '../utils/timezone.util';
import type {
  CollectorContext,
  SignalCollector,
} from './signal-collector.interface';

/**
 * The shelf: what has run out, and what is about to.
 *
 * Both halves are the same arithmetic — a rate against a quantity — but they
 * are two kinds and two sentences on purpose. A restock is a plan for next
 * week; a stockout is money not being made this afternoon, and an owner sorting
 * by severity needs that difference to be real.
 *
 * Everything here is per **variant**, because stock is per variant. Advice
 * about a shelf that says "Teddy Bear XL" without saying "size M" is advice the
 * owner cannot act on.
 */
@Injectable()
export class StockSignalCollector implements SignalCollector {
  readonly name = 'stock';

  constructor(
    private readonly productService: ProductService,
    private readonly orderAnalytics: OrderAnalyticsService,
  ) {}

  async collect({
    store,
    settings,
    now,
  }: CollectorContext): Promise<AdvisorSignal[]> {
    const [stockLevels, recentSales] = await Promise.all([
      this.productService.listStockLevels(store.id),
      this.orderAnalytics.sumSalesByVariant({
        storeId: store.id,
        since: subtractDays(now, VELOCITY_RECENT_DAYS),
      }),
    ]);

    const unitsByVariant = new Map(
      recentSales.map((sale) => [sale.variantId, sale.units]),
    );

    const signals: AdvisorSignal[] = [];

    for (const level of stockLevels) {
      const recentUnits = unitsByVariant.get(level.variantId) ?? 0;
      const unitsPerDay = calculateVelocity({
        units: recentUnits,
        days: VELOCITY_RECENT_DAYS,
      });

      if (level.stockQuantity <= 0) {
        // Sold out and never selling is not news — it is a product the owner
        // stopped stocking, and the slow-mover half has nothing to say either.
        if (recentUnits > 0) {
          signals.push(this.buildStockout(level, recentUnits, unitsPerDay));
        }
        continue;
      }

      const recommendation = recommendRestock({
        stockQuantity: level.stockQuantity,
        unitsPerDay,
        leadTimeDays: settings.leadTimeDays,
      });
      if (
        recommendation.needsRestock &&
        recommendation.daysOfCoverage !== null
      ) {
        signals.push(
          this.buildRestock({
            level,
            unitsPerDay,
            daysOfCoverage: recommendation.daysOfCoverage,
            recommendedQuantity: recommendation.recommendedQuantity,
            leadTimeDays: settings.leadTimeDays,
          }),
        );
      }
    }

    return signals;
  }

  private buildStockout(
    level: Awaited<ReturnType<ProductService['listStockLevels']>>[number],
    recentUnits: number,
    unitsPerDay: number,
  ): AdvisorSignal {
    // What a day of being out of stock costs, at the rate it was selling.
    const estimatedDailyLoss = Math.round(unitsPerDay * level.priceAmount);

    return {
      kind: AdvisorInsightKind.Stockout,
      severity: AdvisorSeverity.Critical,
      dedupeKey: `stockout:${level.variantId}`,
      impactAmount: estimatedDailyLoss,
      payload: {
        productId: level.productId,
        productTitle: level.productTitle,
        variantId: level.variantId,
        variantLabel: level.variantLabel,
        unitsSoldRecent: recentUnits,
        estimatedDailyLoss,
      },
    };
  }

  private buildRestock({
    level,
    unitsPerDay,
    daysOfCoverage,
    recommendedQuantity,
    leadTimeDays,
  }: {
    level: Awaited<ReturnType<ProductService['listStockLevels']>>[number];
    unitsPerDay: number;
    daysOfCoverage: number;
    recommendedQuantity: number;
    leadTimeDays: number;
  }): AdvisorSignal {
    return {
      kind: AdvisorInsightKind.Restock,
      severity: AdvisorSeverity.Warning,
      dedupeKey: `restock:${level.variantId}`,
      // The revenue at risk: the days inside the horizon this shelf will spend
      // empty, at the price and rate it sells for.
      impactAmount: Math.round(
        unitsPerDay *
          level.priceAmount *
          Math.max(0, leadTimeDays - daysOfCoverage),
      ),
      payload: {
        productId: level.productId,
        productTitle: level.productTitle,
        variantId: level.variantId,
        variantLabel: level.variantLabel,
        stockQuantity: level.stockQuantity,
        unitsPerDay: roundRate(unitsPerDay),
        daysOfCoverage: roundRate(daysOfCoverage),
        recommendedQuantity,
        leadTimeDays,
      },
    };
  }
}

/** Two decimals: a payload carries a rate, not a floating-point artefact. */
function roundRate(value: number): number {
  return Math.round(value * 100) / 100;
}
