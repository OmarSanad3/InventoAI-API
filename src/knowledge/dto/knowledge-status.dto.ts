import { KnowledgeSourceType } from '../enums/knowledge-source-type.enum';

export class KnowledgeSourceStatusDto {
  sourceType!: KnowledgeSourceType;
  total!: number;
  indexed!: number;
  stale!: number;
  failed!: number;
}

/** What the dashboard shows about the store's index, and why answers may lag. */
export class KnowledgeStatusDto {
  total!: number;

  /** Documents that have a vector. `total - indexed` have never been embedded. */
  indexed!: number;

  /** Composed but changed since; still retrievable, just slightly behind. */
  stale!: number;

  /** Past `MAX_INDEX_FAILURES`, so the sweeper has stopped retrying them. */
  failed!: number;

  lastIndexedAt!: Date | null;

  /**
   * `false` when the `vector` extension is missing — the one fact that explains
   * why a store's chatbot answers got worse without anything else changing.
   */
  vectorSearchAvailable!: boolean;

  embeddingModel!: string;

  sources!: KnowledgeSourceStatusDto[];
}
