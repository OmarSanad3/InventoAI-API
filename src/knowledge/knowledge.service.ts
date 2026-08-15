import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { RedisService } from '../redis/redis.service';
import { StoreService } from '../site-builder/store.service';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from './embedding.provider';
import {
  KnowledgeSourceStatusDto,
  KnowledgeStatusDto,
} from './dto/knowledge-status.dto';
import { KnowledgeDocument } from './entities/knowledge-document.entity';
import { KnowledgeSourceType } from './enums/knowledge-source-type.enum';
import { KnowledgeIndexer } from './knowledge-indexer.service';
import { KnowledgeVectorInitializer } from './knowledge-vector.initializer';
import {
  KNOWLEDGE_REINDEX_COOLDOWN_SECONDS,
  MAX_INDEX_FAILURES,
  REINDEX_COOLDOWN_KEY_PREFIX,
} from './knowledge.constants';

/** Marks the cooldown; the value is never read, only its TTL. */
const COOLDOWN_MARKER = '1';

interface StatusRow {
  readonly sourceType: KnowledgeSourceType;
  readonly total: number;
  readonly indexed: number;
  readonly stale: number;
  readonly failed: number;
  readonly lastIndexedAt: Date | null;
}

/** The dashboard's half of the knowledge base: what the index holds, and rebuild. */
@Injectable()
export class KnowledgeService {
  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepository: Repository<KnowledgeDocument>,
    private readonly storeService: StoreService,
    private readonly indexer: KnowledgeIndexer,
    private readonly vectorInitializer: KnowledgeVectorInitializer,
    private readonly redisService: RedisService,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async getStatus(user: JwtPayload): Promise<KnowledgeStatusDto> {
    const store = await this.storeService.resolveCallerStore(user);
    return this.buildStatus(store.id);
  }

  /**
   * Re-derives the store's document set and marks it stale; the sweeper does the
   * embedding. Returns the status rather than a 202 — nothing was created, and
   * the counts are the useful answer.
   */
  async reindex(user: JwtPayload): Promise<KnowledgeStatusDto> {
    const store = await this.storeService.resolveCallerStore(user);
    await this.enforceCooldown(store.id);

    await this.indexer.reconcile(store.id);
    return this.buildStatus(store.id);
  }

  /** One grouped query; the totals are summed from its rows rather than re-queried. */
  private async buildStatus(storeId: string): Promise<KnowledgeStatusDto> {
    const rows = await this.documentRepository.manager.query<StatusRow[]>(
      `SELECT "sourceType",
              COUNT(*)::int                                        AS total,
              COUNT(*) FILTER (WHERE "indexedAt" IS NOT NULL)::int AS indexed,
              COUNT(*) FILTER (WHERE "isStale")::int               AS stale,
              COUNT(*) FILTER (WHERE "failureCount" >= $2)::int    AS failed,
              MAX("indexedAt")                                     AS "lastIndexedAt"
         FROM knowledge_documents
        WHERE "storeId" = $1
        GROUP BY "sourceType"`,
      [storeId, MAX_INDEX_FAILURES],
    );

    const sources: KnowledgeSourceStatusDto[] = rows.map((row) => ({
      sourceType: row.sourceType,
      total: row.total,
      indexed: row.indexed,
      stale: row.stale,
      failed: row.failed,
    }));

    const lastIndexedAt = rows
      .map((row) => row.lastIndexedAt)
      .filter((value): value is Date => value !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      total: sumOf(sources, 'total'),
      indexed: sumOf(sources, 'indexed'),
      stale: sumOf(sources, 'stale'),
      failed: sumOf(sources, 'failed'),
      lastIndexedAt: lastIndexedAt ?? null,
      vectorSearchAvailable: this.vectorInitializer.hasVectorSearch(),
      embeddingModel: this.embeddings.modelId,
      sources,
    };
  }

  private async enforceCooldown(storeId: string): Promise<void> {
    const key = `${REINDEX_COOLDOWN_KEY_PREFIX}:${storeId}`;
    const remaining = await this.redisService.ttl(key);
    if (remaining > 0) {
      throw new HttpException(
        `The knowledge base was rebuilt moments ago, please wait ${remaining} seconds before rebuilding again`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.redisService.setex(
      key,
      KNOWLEDGE_REINDEX_COOLDOWN_SECONDS,
      COOLDOWN_MARKER,
    );
  }
}

function sumOf(
  sources: readonly KnowledgeSourceStatusDto[],
  field: 'total' | 'indexed' | 'stale' | 'failed',
): number {
  return sources.reduce((sum, source) => sum + source[field], 0);
}
