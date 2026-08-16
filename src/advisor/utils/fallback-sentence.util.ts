import { AdvisorInsightKind } from '../enums/advisor-insight-kind.enum';
import type { AdvisorSignal } from '../types/advisor-signal.type';

/**
 * The brief, written without a model.
 *
 * This is not a degraded mode bolted on afterwards — it is the default, and the
 * narrator is an improvement on it. Every line here is assembled from the
 * signal's own numbers, so a Gemini outage costs the brief its charm and
 * nothing else. `buildFallbackSentence` has a case for every
 * `AdvisorInsightKind`, asserted by a test that iterates the enum, so a new
 * kind cannot ship without one.
 */

export interface InsightProse {
  title: string;
  body: string;
}

/** Minor units to something a sentence can contain: `249000` → `2,490 EGP`. */
export function formatMoney(amount: number, currency: string): string {
  const major = amount / 100;
  const formatted = major.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} ${currency}`;
}

/** `2.4` from a ratio, `3` from `3.0` — a brief does not say "3.0× faster". */
function formatRatio(ratio: number): string {
  return Number.isInteger(ratio) ? String(ratio) : ratio.toFixed(1);
}

function formatDays(days: number): string {
  const whole = Math.max(0, Math.round(days));
  return whole === 1 ? '1 day' : `${whole} days`;
}

function formatUnits(units: number): string {
  const whole = Math.max(0, Math.round(units));
  return whole === 1 ? '1 unit' : `${whole} units`;
}

/** "Teddy Bear XL (Size: M)" when the variant is one of several. */
function describeVariant(
  productTitle: string,
  variantLabel: string | null,
): string {
  return variantLabel ? `${productTitle} (${variantLabel})` : productTitle;
}

export function buildFallbackSentence(
  signal: AdvisorSignal,
  currency: string,
): InsightProse {
  switch (signal.kind) {
    case AdvisorInsightKind.Stockout: {
      const {
        productTitle,
        variantLabel,
        unitsSoldRecent,
        estimatedDailyLoss,
      } = signal.payload;
      return {
        title: `Out of stock: ${describeVariant(productTitle, variantLabel)}`,
        body:
          `It sold ${formatUnits(unitsSoldRecent)} in the last week and there is ` +
          `nothing left. At that rate you are losing about ` +
          `${formatMoney(estimatedDailyLoss, currency)} a day until it is back.`,
      };
    }

    case AdvisorInsightKind.Restock: {
      const {
        productTitle,
        variantLabel,
        stockQuantity,
        daysOfCoverage,
        recommendedQuantity,
        leadTimeDays,
      } = signal.payload;
      return {
        title: `Running low: ${describeVariant(productTitle, variantLabel)}`,
        body:
          `${formatUnits(stockQuantity)} left — about ${formatDays(daysOfCoverage)} ` +
          `at the current rate, and your supplier needs ${formatDays(leadTimeDays)}. ` +
          `Reorder around ${recommendedQuantity} to stay ahead of it.`,
      };
    }

    case AdvisorInsightKind.Trending: {
      const { productTitle, recentUnits, baselineUnits, ratio } =
        signal.payload;
      const comparison =
        ratio === null
          ? 'with none sold in the four weeks before that'
          : `${formatRatio(ratio)}× the rate of the four weeks before that`;
      return {
        title: `Selling fast: ${productTitle}`,
        body:
          `${formatUnits(recentUnits)} in the last week — ${comparison} ` +
          `(${formatUnits(baselineUnits)}). Worth putting on the homepage while it lasts.`,
      };
    }

    case AdvisorInsightKind.SlowMover: {
      const { productTitle, stockQuantity, tiedUpAmount, daysSinceLastSale } =
        signal.payload;
      const idle =
        daysSinceLastSale === null
          ? 'It has never sold'
          : `Nothing has sold in ${formatDays(daysSinceLastSale)}`;
      return {
        title: `Sitting still: ${productTitle}`,
        body:
          `${idle}, and ${formatUnits(stockQuantity)} are holding ` +
          `${formatMoney(tiedUpAmount, currency)} of your cash. Consider a discount ` +
          `or a bundle to move it.`,
      };
    }

    case AdvisorInsightKind.DemandGap: {
      const { label, occurrences, exampleQuestion } = signal.payload;
      return {
        title: `${occurrences} shoppers asked for "${label}"`,
        body:
          `Your assistant could not answer them — one asked: "${exampleQuestion}". ` +
          `You do not stock it yet. Consider adding it.`,
      };
    }

    case AdvisorInsightKind.SeasonalEvent: {
      const { eventName, daysUntil, matchedCategoryNames } = signal.payload;
      const when =
        daysUntil === 0 ? 'starts today' : `starts in ${formatDays(daysUntil)}`;
      const categories =
        matchedCategoryNames.length > 0
          ? ` Your ${matchedCategoryNames.join(' and ')} should be stocked and on the homepage.`
          : ' Worth planning your stock and homepage around it.';
      return {
        title: `${eventName} ${when}`,
        body: `${eventName} ${when}.${categories}`,
      };
    }

    case AdvisorInsightKind.Weather: {
      const { anomaly, maxTempC, minTempC, onDate } = signal.payload;
      if (anomaly === 'heatwave') {
        return {
          title: `Heat forecast: ${Math.round(maxTempC)}°C on ${onDate}`,
          body:
            `It reaches ${Math.round(maxTempC)}°C on ${onDate}. Move anything light, ` +
            `cold or summery to the front of the store this week.`,
        };
      }
      if (anomaly === 'cold_snap') {
        return {
          title: `Cold forecast: ${Math.round(minTempC)}°C on ${onDate}`,
          body:
            `It drops to ${Math.round(minTempC)}°C on ${onDate}. Warm clothing and ` +
            `anything for staying in should lead the homepage.`,
        };
      }
      return {
        title: `Rain forecast on ${onDate}`,
        body:
          `Heavy rain is forecast for ${onDate}. Expect quieter foot traffic and ` +
          `busier delivery — make sure the stock behind it is there.`,
      };
    }
  }
}

/** The one-line summary at the top, when the narrator did not write one. */
export function buildFallbackHeadline(
  signals: readonly AdvisorSignal[],
): string {
  if (signals.length === 0) {
    return 'Nothing needs your attention today.';
  }

  const urgent = signals.filter(
    (signal) =>
      signal.kind === AdvisorInsightKind.Stockout ||
      signal.kind === AdvisorInsightKind.Restock,
  ).length;

  const noun = signals.length === 1 ? 'thing' : 'things';
  if (urgent === 0) {
    return `${signals.length} ${noun} worth a look today.`;
  }

  const stock = urgent === 1 ? '1 needs stock' : `${urgent} need stock`;
  return `${signals.length} ${noun} worth a look today — ${stock}.`;
}
