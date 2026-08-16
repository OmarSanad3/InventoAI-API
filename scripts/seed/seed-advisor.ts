import { AdvisorBriefService } from '../../src/advisor/advisor-brief.service';
import { AdvisorGenerator } from '../../src/advisor/enums/advisor-generator.enum';
import { StoreStatus } from '../../src/site-builder/enums/store-status.enum';
import { SeededStore } from './seed-stores';

/** One store's brief, kept so the report can name its date and size. */
export interface SeededAdvisor {
  readonly storeSlug: string;
  readonly briefDate: string;
  readonly insightCount: number;
  readonly headline: string;
  /** Which kinds actually fired, so the report can prove the fixtures work. */
  readonly kinds: string[];
}

/**
 * Writes today's brief for each live seeded store, through the same service the
 * scheduler calls.
 *
 * It generates rather than fabricates rows for the same reason the seeded
 * products' aggregates go through `recalculateAggregates`: a fixture that
 * computed its own insights would be the first place the Advisor's arithmetic
 * could start disagreeing with itself.
 *
 * `draftco` is skipped — a draft store has no orders, no shoppers and no stock,
 * and gets no advice.
 */
export async function seedAdvisor(
  briefService: AdvisorBriefService,
  stores: readonly SeededStore[],
): Promise<SeededAdvisor[]> {
  const seeded: SeededAdvisor[] = [];

  for (const { store, definition } of stores) {
    if (definition.status !== StoreStatus.Live) {
      continue;
    }

    const brief = await briefService.generateForStore({
      store,
      generatedBy: AdvisorGenerator.Schedule,
    });
    // A store with nothing wrong gets no brief, which is the same answer the
    // scheduler gives at 7am.
    if (!brief) {
      continue;
    }

    seeded.push({
      storeSlug: definition.slug,
      briefDate: brief.briefDate,
      insightCount: brief.insightCount,
      headline: brief.headline,
      kinds: [
        ...new Set((brief.insights ?? []).map((insight) => insight.kind)),
      ],
    });
  }

  return seeded;
}
