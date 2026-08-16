/**
 * Who wrote the prose in this brief.
 *
 * On the row rather than inferred, because "why does today's brief read like a
 * robot" is a support question and the answer should be one column rather than
 * a log grep.
 */
export enum NarratorStatus {
  /** Gemini answered. */
  Ai = 'ai',
  /** It did not, and `buildFallbackSentence` rendered every line. */
  Fallback = 'fallback',
}
