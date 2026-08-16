/**
 * The semantic half of the unanswered grouping: it merges deterministic groups
 * whose meanings coincide, which is what pulls "earbuds", "airpods" and
 * "سماعات لاسلكية" onto one line.
 *
 * Pure, and separated from the service that embeds, because the decision worth
 * trusting here is the merge rule and not the API call. It is greedy rather
 * than k-means for a reason the data forces: there is no k. The number of things
 * a store's shoppers ask for that it does not sell is exactly what the owner is
 * trying to find out.
 */

/** One deterministic group, reduced to what a merge decision needs. */
export interface ClusterCandidate {
  readonly key: string;
  readonly occurrences: number;
  readonly vector: readonly number[];
}

/**
 * Assigns each candidate a cluster key: the key of the first candidate that
 * seeded its cluster.
 *
 * Candidates are consumed **in the order given**, so a caller passing them
 * most-frequent-first gets the busiest theme as every cluster's seed — which is
 * also the label an owner recognises.
 */
export function clusterThemes(
  candidates: readonly ClusterCandidate[],
  { threshold }: { threshold: number },
): Map<string, string> {
  const assignment = new Map<string, string>();
  const clusters: { key: string; centroid: number[]; weight: number }[] = [];

  for (const candidate of candidates) {
    const nearest = findNearest(clusters, candidate.vector, threshold);

    if (!nearest) {
      assignment.set(candidate.key, candidate.key);
      clusters.push({
        key: candidate.key,
        centroid: [...candidate.vector],
        weight: candidate.occurrences,
      });
      continue;
    }

    assignment.set(candidate.key, nearest.key);
    // Weighted by occurrences, so one stray phrasing cannot drag a cluster of
    // forty onto a different meaning.
    absorb(nearest, candidate);
  }

  return assignment;
}

function findNearest(
  clusters: readonly { key: string; centroid: number[]; weight: number }[],
  vector: readonly number[],
  threshold: number,
): { key: string; centroid: number[]; weight: number } | null {
  let best: { key: string; centroid: number[]; weight: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const cluster of clusters) {
    const distance = cosineDistance(cluster.centroid, vector);
    if (distance <= threshold && distance < bestDistance) {
      best = cluster;
      bestDistance = distance;
    }
  }
  return best;
}

function absorb(
  cluster: { centroid: number[]; weight: number },
  candidate: ClusterCandidate,
): void {
  const total = cluster.weight + candidate.occurrences;
  for (let i = 0; i < cluster.centroid.length; i += 1) {
    cluster.centroid[i] =
      (cluster.centroid[i] * cluster.weight +
        candidate.vector[i] * candidate.occurrences) /
      total;
  }
  cluster.weight = total;
}

/**
 * `1 - cosine similarity`, computed with both magnitudes rather than assuming
 * unit length: the vectors that arrive are unit length, but a centroid of two
 * of them is not, and skipping the norm would make a merged cluster look
 * steadily closer to everything.
 *
 * Mismatched lengths and a zero vector both return the maximum distance, so a
 * malformed embedding merges with nothing instead of merging with everything.
 */
export function cosineDistance(
  a: readonly number[],
  b: readonly number[],
): number {
  if (a.length === 0 || a.length !== b.length) {
    return 2;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 2;
  }
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
