import { MAX_INSIGHTS_PER_BRIEF } from '../advisor.constants';
import { AdvisorInsightKind } from '../enums/advisor-insight-kind.enum';
import { AdvisorSeverity } from '../enums/advisor-severity.enum';
import type { AdvisorSignal } from '../types/advisor-signal.type';

/**
 * Which eight things an owner is told, and in what order.
 *
 * Every tie is broken by something stable, all the way down to the dedupe key,
 * so the same signals ranked twice produce the same brief. That is not
 * fastidiousness: it is what makes "generate it again and compare" a usable
 * test, and it is what stops a manual regeneration from quietly reshuffling a
 * brief the owner has already read.
 */

const SEVERITY_ORDER: Record<AdvisorSeverity, number> = {
  [AdvisorSeverity.Critical]: 0,
  [AdvisorSeverity.Warning]: 1,
  [AdvisorSeverity.Info]: 2,
};

/** The enum's own declaration order: loudest kind first. */
const KIND_ORDER: Record<AdvisorInsightKind, number> = Object.fromEntries(
  Object.values(AdvisorInsightKind).map((kind, index) => [kind, index]),
) as Record<AdvisorInsightKind, number>;

export function rankInsights(
  signals: readonly AdvisorSignal[],
  limit: number = MAX_INSIGHTS_PER_BRIEF,
): AdvisorSignal[] {
  return [...signals].sort(compareSignals).slice(0, Math.max(0, limit));
}

function compareSignals(left: AdvisorSignal, right: AdvisorSignal): number {
  const bySeverity =
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
  if (bySeverity !== 0) {
    return bySeverity;
  }

  // Money at stake, descending — the same shelf is worth more advice.
  const byImpact = right.impactAmount - left.impactAmount;
  if (byImpact !== 0) {
    return byImpact;
  }

  const byKind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
  if (byKind !== 0) {
    return byKind;
  }

  // Same kind, so a unitless magnitude is safe to compare: a demand gap asked
  // 40 times outranks one asked 3 times, and nothing else uses it.
  const byRankWithin = (right.rankWithin ?? 0) - (left.rankWithin ?? 0);
  if (byRankWithin !== 0) {
    return byRankWithin;
  }

  return left.dedupeKey.localeCompare(right.dedupeKey);
}
