import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, LessThan, Repository } from 'typeorm';
import { KnowledgeDocument } from './entities/knowledge-document.entity';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from './embedding.provider';
import { DocumentKey, KnowledgeComposer } from './knowledge-composer.service';
import { KnowledgeVectorInitializer } from './knowledge-vector.initializer';
import {
  KNOWLEDGE_EMBEDDINGS_TABLE,
  KNOWLEDGE_SWEEP_BATCH,
  MAX_INDEX_FAILURES,
} from './knowledge.constants';
import { hashDocumentContent } from './utils/build-document.util';
import { toVectorLiteral } from './utils/normalize-vector.util';

export interface IndexPassResult {
  readonly composed: number;
  readonly embedded: number;
  readonly unchanged: number;
  readonly removed: number;
  readonly failed: number;
}

const EMPTY_PASS: IndexPassResult = {
  composed: 0,
  embedded: 0,
  unchanged: 0,
  removed: 0,
  failed: 0,
};

/**
 * Owns every write to `knowledge_documents` and to the vector table beside it.
 *
 * The freshness contract, from the epic's §9: a source write only ever flips a
 * flag — cheap, transactional, and impossible to couple to an AI provider's
 * uptime — and this class does the expensive half later, in batches, out of
 * band.
 */
@Injectable()
export class KnowledgeIndexer {
  private readonly logger = new Logger(KnowledgeIndexer.name);

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepository: Repository<KnowledgeDocument>,
    private readonly composer: KnowledgeComposer,
    private readonly vectorInitializer: KnowledgeVectorInitializer,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddings: EmbeddingProvider,
  ) {}

  /**
   * Upserts a document as stale. Takes the caller's `EntityManager` so the mark
   * lives or dies with the transaction that caused it — a rolled-back product
   * save must not leave a document claiming the product changed.
   *
   * Only `isStale` and `updatedAt` are overwritten on conflict: touching `id`
   * would orphan the vector row that references it.
   */
  async markStale(manager: EntityManager, key: DocumentKey): Promise<void> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(KnowledgeDocument)
      .values({
        id: randomUUID(),
        storeId: key.storeId,
        sourceType: key.sourceType,
        sourceId: key.sourceId,
        content: '',
        contentHash: '',
        isStale: true,
        failureCount: 0,
      })
      .orUpdate(['isStale', 'updatedAt'], ['storeId', 'sourceType', 'sourceId'])
      .execute();
  }

  /** Removes a document the moment its source leaves the storefront. */
  async removeDocument(
    manager: EntityManager,
    key: DocumentKey,
  ): Promise<void> {
    await manager.delete(KnowledgeDocument, {
      storeId: key.storeId,
      sourceType: key.sourceType,
      sourceId: key.sourceId,
    });
  }

  /**
   * Re-derives a store's document set from its source rows: inserts what is
   * missing, deletes what no longer qualifies, and marks the rest stale so the
   * next sweep re-composes and re-hashes them.
   *
   * This is the answer to everything that wrote around the ORM — a seed, a
   * manual `UPDATE`, a query-builder bulk write no subscriber sees. Because an
   * unchanged document's hash does not move, a full pass costs close to zero
   * embedding calls.
   */
  async reconcile(storeId: string): Promise<{
    added: number;
    removed: number;
    kept: number;
  }> {
    const expected = await this.composer.listSourceIds(storeId);
    const existing = await this.documentRepository.find({
      where: { storeId },
      select: { id: true, sourceType: true, sourceId: true },
    });

    const existingKeys = new Set(
      existing.map((row) => `${row.sourceType}:${row.sourceId}`),
    );
    const expectedKeys = new Set<string>();
    const missing: Partial<KnowledgeDocument>[] = [];

    for (const [sourceType, sourceIds] of expected) {
      for (const sourceId of sourceIds) {
        const compositeKey = `${sourceType}:${sourceId}`;
        expectedKeys.add(compositeKey);
        if (!existingKeys.has(compositeKey)) {
          missing.push({
            id: randomUUID(),
            storeId,
            sourceType,
            sourceId,
            content: '',
            contentHash: '',
            isStale: true,
          });
        }
      }
    }

    const staleIds = existing
      .filter((row) => !expectedKeys.has(`${row.sourceType}:${row.sourceId}`))
      .map((row) => row.id);

    if (missing.length > 0) {
      await this.documentRepository.insert(missing);
    }
    if (staleIds.length > 0) {
      await this.documentRepository.delete({ id: In(staleIds) });
    }
    await this.documentRepository.update({ storeId }, { isStale: true });

    return {
      added: missing.length,
      removed: staleIds.length,
      kept: existing.length - staleIds.length,
    };
  }

  /**
   * One sweep: take the oldest stale documents, compose them, and embed only
   * the ones whose text actually moved.
   *
   * Skipped entirely when pgvector is unavailable — writing content without a
   * vector would leave the index claiming to be fresh while nothing can be
   * retrieved from it.
   */
  async indexPending(limit = KNOWLEDGE_SWEEP_BATCH): Promise<IndexPassResult> {
    if (!this.vectorInitializer.hasVectorSearch()) {
      return EMPTY_PASS;
    }

    const documents = await this.documentRepository.find({
      where: { isStale: true, failureCount: LessThan(MAX_INDEX_FAILURES) },
      order: { updatedAt: 'ASC' },
      take: limit,
    });
    if (documents.length === 0) {
      return EMPTY_PASS;
    }

    const removed: string[] = [];
    const unchanged: string[] = [];
    const pending: { document: KnowledgeDocument; content: string }[] = [];

    for (const document of documents) {
      const content = await this.composer.compose(document);
      if (content === null) {
        removed.push(document.id);
        continue;
      }

      const contentHash = hashDocumentContent(content);
      // An unchanged hash still needs a first embedding — `indexedAt` is what
      // says a vector exists, not the hash.
      if (contentHash === document.contentHash && document.indexedAt !== null) {
        unchanged.push(document.id);
        continue;
      }
      pending.push({ document, content });
    }

    if (removed.length > 0) {
      await this.documentRepository.delete({ id: In(removed) });
    }
    if (unchanged.length > 0) {
      await this.documentRepository.update(
        { id: In(unchanged) },
        { isStale: false, failureCount: 0 },
      );
    }

    const failed = await this.embedPending(pending);

    return {
      composed: documents.length,
      embedded: pending.length - failed,
      unchanged: unchanged.length,
      removed: removed.length,
      failed,
    };
  }

  /** Returns how many documents failed; a whole-batch failure counts them all. */
  private async embedPending(
    pending: readonly { document: KnowledgeDocument; content: string }[],
  ): Promise<number> {
    if (pending.length === 0) {
      return 0;
    }

    let vectors: number[][];
    try {
      vectors = await this.embeddings.embedDocuments(
        pending.map((entry) => entry.content),
      );
    } catch (err) {
      this.logger.warn(
        `Embedding pass failed for ${pending.length} documents: ${String(err)}`,
      );
      await this.documentRepository.increment(
        { id: In(pending.map((entry) => entry.document.id)) },
        'failureCount',
        1,
      );
      return pending.length;
    }

    await this.documentRepository.manager.transaction(async (manager) => {
      for (const [index, entry] of pending.entries()) {
        await manager.query(
          `INSERT INTO "${KNOWLEDGE_EMBEDDINGS_TABLE}" ("documentId", embedding)
           VALUES ($1, $2::vector)
           ON CONFLICT ("documentId") DO UPDATE SET embedding = EXCLUDED.embedding`,
          [entry.document.id, toVectorLiteral(vectors[index])],
        );
        await manager.update(KnowledgeDocument, entry.document.id, {
          content: entry.content,
          contentHash: hashDocumentContent(entry.content),
          isStale: false,
          failureCount: 0,
          indexedAt: new Date(),
          embeddingModel: this.embeddings.modelId,
        });
      }
    });

    return 0;
  }

  /** Every store, for the nightly reconcile — including ones never indexed. */
  async listStoreIds(): Promise<string[]> {
    return this.composer.listStoreIds();
  }

  /** The three numbers the seed report prints. The dashboard's status is richer. */
  async countDocuments(
    storeId: string,
  ): Promise<{ documents: number; indexed: number; failed: number }> {
    const [row] = await this.documentRepository.manager.query<
      { documents: number; indexed: number; failed: number }[]
    >(
      `SELECT COUNT(*)::int                                        AS documents,
              COUNT(*) FILTER (WHERE "indexedAt" IS NOT NULL)::int AS indexed,
              COUNT(*) FILTER (WHERE "failureCount" >= $2)::int    AS failed
         FROM knowledge_documents
        WHERE "storeId" = $1`,
      [storeId, MAX_INDEX_FAILURES],
    );
    return row ?? { documents: 0, indexed: 0, failed: 0 };
  }
}
