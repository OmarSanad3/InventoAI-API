import { RRF_K } from '../knowledge.constants';

export interface FusedResult {
  readonly id: string;
  readonly score: number;
}

/**
 * Reciprocal Rank Fusion over any number of ranked lists.
 *
 * ```
 * score(id) = Σ over each list  1 / (RRF_K + rank)
 * ```
 *
 * Positions only, never the underlying scores: `ts_rank_cd` and cosine
 * similarity share no scale and never will, so any weighted sum of the two is a
 * tuning exercise that never converges. RRF needs no normalisation and no
 * tuning, which is why it is the default in hybrid search.
 *
 * Each input list must already be ordered best-first. A duplicate id inside one
 * list counts once, at its best position.
 */
export function fuseByReciprocalRank(
  lists: readonly (readonly string[])[],
  limit?: number,
): FusedResult[] {
  const scores = new Map<string, number>();
  const bestRank = new Map<string, number>();

  for (const list of lists) {
    const seen = new Set<string>();
    list.forEach((id, index) => {
      if (seen.has(id)) {
        return;
      }
      seen.add(id);

      const rank = index + 1;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank));
      bestRank.set(id, Math.min(bestRank.get(id) ?? rank, rank));
    });
  }

  const fused = [...scores]
    .map(([id, score]) => ({ id, score }))
    // Ties break on the better original rank, then on id — a stable order, so
    // two calls with the same inputs cannot return two different orderings.
    .sort(
      (a, b) =>
        b.score - a.score ||
        (bestRank.get(a.id) ?? 0) - (bestRank.get(b.id) ?? 0) ||
        a.id.localeCompare(b.id),
    );

  return limit === undefined ? fused : fused.slice(0, limit);
}
