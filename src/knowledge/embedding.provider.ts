/**
 * The seam between the knowledge base and whoever turns text into vectors.
 *
 * It exists because the dimension count is baked into a column type — changing
 * model means rebuilding the table, so the boundary is worth having *before*
 * that happens rather than after. One adapter ships today
 * (`GeminiEmbeddingProvider`); a local model behind the same interface is the
 * obvious offline-development follow-up.
 */
export interface EmbeddingProvider {
  /**
   * Indexing side. Callers may pass more texts than one API call accepts — the
   * adapter batches. Returns one unit-length vector per input, in order.
   */
  embedDocuments(texts: readonly string[]): Promise<number[][]>;

  /**
   * Searching side, and deliberately a separate method: the task type is
   * asymmetric, and using the document type for a query quietly costs recall
   * while nothing fails.
   */
  embedQuery(text: string): Promise<number[]>;

  readonly dimensions: number;
  readonly modelId: string;
}

export const EMBEDDING_PROVIDER = 'EMBEDDING_PROVIDER';
