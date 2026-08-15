import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  SEARCH_RANK_NORMALIZATION,
  SEARCH_TEXT_CONFIG,
} from '../catalog/catalog.constants';
import { PublicProductService } from '../catalog/public-product.service';
import { buildSearchQuery } from '../catalog/utils/search-query.util';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from './embedding.provider';
import { KnowledgeDocument } from './entities/knowledge-document.entity';
import { KnowledgeSourceType } from './enums/knowledge-source-type.enum';
import { KnowledgeVectorInitializer } from './knowledge-vector.initializer';
import {
  KNOWLEDGE_EMBEDDINGS_TABLE,
  KNOWLEDGE_MIN_SCORE,
  KNOWLEDGE_RETRIEVAL_LIMIT,
} from './knowledge.constants';
import { fuseByReciprocalRank } from './utils/reciprocal-rank.util';
import { toVectorLiteral } from './utils/normalize-vector.util';

export interface KnowledgeHit {
  readonly sourceType: KnowledgeSourceType;
  readonly sourceId: string;
  /** The composed document, as the snippet a model reads. Never product data. */
  readonly content: string;
  /** Fused rank score. Comparable within one result set, not across queries. */
  readonly score: number;
}

export interface RetrievalParams {
  readonly storeId: string;
  readonly query: string;
  readonly sourceTypes?: readonly KnowledgeSourceType[];
  readonly limit?: number;
}

interface VectorRow {
  readonly sourceType: KnowledgeSourceType;
  readonly sourceId: string;
  readonly content: string;
  readonly score: string | number;
}

/**
 * Hybrid retrieval over a single store's knowledge base.
 *
 * Vector similarity alone would regress the cases the catalog already handles
 * well — an exact SKU, a brand name, an Arabic word that appears verbatim in a
 * title. Lexical search alone is what the chatbot exists to improve on. So both
 * run and the ranks are fused.
 *
 * **Hits are pointers, not payloads.** A hit carries a source id and a snippet
 * and no product data at all; the caller loads the live row through the service
 * that owns it, with the storefront predicates applied again. That is what makes
 * a stale index survivable — the index can be wrong, the answer cannot.
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepository: Repository<KnowledgeDocument>,
    private readonly publicProductService: PublicProductService,
    private readonly vectorInitializer: KnowledgeVectorInitializer,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async search(params: RetrievalParams): Promise<KnowledgeHit[]> {
    const limit = params.limit ?? KNOWLEDGE_RETRIEVAL_LIMIT;
    const search = buildSearchQuery(params.query);
    if (!search) {
      return [];
    }

    const [vectorRows, lexicalIds] = await Promise.all([
      this.searchByVector(params, limit),
      this.searchLexically(params, search.tsquery, limit),
    ]);

    const fused = fuseByReciprocalRank(
      [
        vectorRows.map((row) => keyOf(row.sourceType, row.sourceId)),
        lexicalIds.map((id) => keyOf(KnowledgeSourceType.Product, id)),
      ],
      limit,
    );

    return this.hydrateSnippets(params.storeId, fused, vectorRows);
  }

  /**
   * `isStale` is deliberately not a predicate: a document whose text changed an
   * hour ago still embeds roughly the same meaning, and a slightly old snippet
   * beats no answer. The join to the embeddings table already excludes anything
   * that was never embedded.
   */
  private async searchByVector(
    params: RetrievalParams,
    limit: number,
  ): Promise<VectorRow[]> {
    if (!this.vectorInitializer.hasVectorSearch()) {
      return [];
    }

    try {
      const vector = await this.embeddings.embedQuery(params.query);
      const sourceTypes = params.sourceTypes?.length
        ? [...params.sourceTypes]
        : null;

      const rows = await this.documentRepository.manager.query<VectorRow[]>(
        `SELECT d."sourceType" AS "sourceType",
                d."sourceId"   AS "sourceId",
                d.content      AS content,
                1 - (e.embedding <=> $1::vector) AS score
           FROM knowledge_documents d
           JOIN "${KNOWLEDGE_EMBEDDINGS_TABLE}" e ON e."documentId" = d.id
          WHERE d."storeId" = $2
            AND ($3::text[] IS NULL OR d."sourceType"::text = ANY($3))
          ORDER BY e.embedding <=> $1::vector
          LIMIT $4`,
        [toVectorLiteral(vector), params.storeId, sourceTypes, limit],
      );

      // The floor is what lets the chatbot tell "nothing relevant" from "eight
      // weak matches" — the nearest neighbour of "1 + 1" is still *something*.
      return rows.filter((row) => Number(row.score) >= KNOWLEDGE_MIN_SCORE);
    } catch (err) {
      // A vector pass that fails degrades retrieval to lexical rather than
      // failing the caller's question.
      this.logger.warn(`Vector retrieval unavailable: ${String(err)}`);
      return [];
    }
  }

  /**
   * The catalog's own ranked full-text search, reused rather than reimplemented:
   * the same `tsvector` weights, the same store and status predicates, so a
   * result here and a result on the products page cannot disagree.
   */
  private async searchLexically(
    params: RetrievalParams,
    tsquery: string,
    limit: number,
  ): Promise<string[]> {
    if (
      params.sourceTypes?.length &&
      !params.sourceTypes.includes(KnowledgeSourceType.Product)
    ) {
      return [];
    }

    const rows = await this.publicProductService
      .buildBaseQuery(params.storeId)
      .select('product.id', 'id')
      .andWhere(
        `product."searchVector" @@ to_tsquery('${SEARCH_TEXT_CONFIG}', :tsquery)`,
        { tsquery },
      )
      .orderBy(
        `ts_rank_cd(product."searchVector", to_tsquery('${SEARCH_TEXT_CONFIG}', :tsquery), ${SEARCH_RANK_NORMALIZATION})`,
        'DESC',
      )
      .addOrderBy('product.createdAt', 'DESC')
      .limit(limit)
      .getRawMany<{ id: string }>();

    return rows.map((row) => row.id);
  }

  /**
   * Attaches a snippet to each fused key. The vector pass already carries its
   * own; a lexical-only hit needs one query for the rest, and keeps an empty
   * snippet when the product has not been indexed yet — the pointer is still
   * good, which is the whole point of hits being pointers.
   */
  private async hydrateSnippets(
    storeId: string,
    fused: readonly { id: string; score: number }[],
    vectorRows: readonly VectorRow[],
  ): Promise<KnowledgeHit[]> {
    const contentByKey = new Map(
      vectorRows.map((row) => [
        keyOf(row.sourceType, row.sourceId),
        row.content,
      ]),
    );

    const missingIds = fused
      .filter((entry) => !contentByKey.has(entry.id))
      .map((entry) => parseKey(entry.id).sourceId);

    if (missingIds.length > 0) {
      const documents = await this.documentRepository.find({
        where: { storeId, sourceId: In(missingIds) },
        select: { sourceType: true, sourceId: true, content: true },
      });
      for (const document of documents) {
        contentByKey.set(
          keyOf(document.sourceType, document.sourceId),
          document.content,
        );
      }
    }

    return fused.map((entry) => {
      const { sourceType, sourceId } = parseKey(entry.id);
      return {
        sourceType,
        sourceId,
        content: contentByKey.get(entry.id) ?? '',
        score: entry.score,
      };
    });
  }
}

/** The two lists live in different id spaces, so fusion needs one shared key. */
function keyOf(sourceType: KnowledgeSourceType, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

function parseKey(key: string): {
  sourceType: KnowledgeSourceType;
  sourceId: string;
} {
  const separator = key.indexOf(':');
  return {
    sourceType: key.slice(0, separator) as KnowledgeSourceType,
    sourceId: key.slice(separator + 1),
  };
}
