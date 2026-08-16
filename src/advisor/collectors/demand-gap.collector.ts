import { Injectable } from '@nestjs/common';
import { ChatInsightsService } from '../../chatbot/chat-insights.service';
import { UNANSWERED_WINDOW_DAYS } from '../../chatbot/chatbot.constants';
import { DEMAND_GAP_MIN_OCCURRENCES } from '../advisor.constants';
import { AdvisorInsightKind } from '../enums/advisor-insight-kind.enum';
import { AdvisorSeverity } from '../enums/advisor-severity.enum';
import type { AdvisorSignal } from '../types/advisor-signal.type';
import { subtractDays } from '../utils/timezone.util';
import type {
  CollectorContext,
  SignalCollector,
} from './signal-collector.interface';

/**
 * What shoppers asked the assistant for and did not get.
 *
 * This collector is four lines of real work because the chatbot epic did the
 * rest: `listUnansweredThemes` is the method branch 3 shipped for exactly this
 * caller, so the Advisor never touches `ChatMessage`, never re-derives the
 * grouping, and cannot disagree with the feed the owner reads in the dashboard.
 *
 * The window is the chat feed's own `UNANSWERED_WINDOW_DAYS` rather than a
 * number of the Advisor's: an owner who opens the feed after reading the brief
 * must see the same themes, and two windows would eventually differ.
 */
@Injectable()
export class DemandGapCollector implements SignalCollector {
  readonly name = 'demand-gap';

  constructor(private readonly chatInsights: ChatInsightsService) {}

  async collect({ store, now }: CollectorContext): Promise<AdvisorSignal[]> {
    const themes = await this.chatInsights.listUnansweredThemes({
      storeId: store.id,
      since: subtractDays(now, UNANSWERED_WINDOW_DAYS),
    });

    return (
      themes
        // One shopper asking once is a coincidence; three is a signal.
        .filter((theme) => theme.occurrences >= DEMAND_GAP_MIN_OCCURRENCES)
        .map((theme) => ({
          kind: AdvisorInsightKind.DemandGap,
          severity: AdvisorSeverity.Warning,
          // The theme's label, which is stable across days for the same demand —
          // the semantic pass merges phrasings under it before this ever runs.
          dedupeKey: `demand_gap:${theme.label}`,
          // There is no honest money figure here: the store does not sell the
          // thing, so nothing it could have earned is knowable. Inventing one
          // from an average order value would be exactly the kind of number this
          // feature refuses to make up — so the ordering goes through
          // `rankWithin`, which is only ever compared against another demand gap.
          impactAmount: 0,
          rankWithin: theme.occurrences,
          payload: {
            label: theme.label,
            occurrences: theme.occurrences,
            exampleQuestion: theme.exampleQuestion,
            lastAskedAt: theme.lastAskedAt,
          },
        }))
    );
  }
}
