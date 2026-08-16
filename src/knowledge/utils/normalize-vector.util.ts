/**
 * Scales a vector to unit length.
 *
 * Only Gemini's full 3072-width output arrives normalised; a Matryoshka
 * truncation to 768 does not, and un-normalised vectors make cosine distances
 * incomparable between rows — which is exactly what an `ORDER BY <=>` compares.
 * Normalising on write also makes cosine distance and inner product agree.
 *
 * A zero vector has no direction to preserve, so it is returned unchanged rather
 * than divided by zero into `NaN`.
 */
export function normalizeVector(values: readonly number[]): number[] {
  const magnitude = Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0),
  );
  if (magnitude === 0 || !Number.isFinite(magnitude)) {
    return [...values];
  }
  return values.map((value) => value / magnitude);
}

/** pgvector's literal form — `[0.1,0.2,0.3]` — for a parameterised `::vector`. */
export function toVectorLiteral(values: readonly number[]): string {
  return `[${values.join(',')}]`;
}
