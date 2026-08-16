import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from '../knowledge/embedding.provider';
import {
  UNANSWERED_CLUSTER_THRESHOLD,
  UNANSWERED_MAX_GROUPS,
} from './chatbot.constants';
import { ChatInsightsService } from './chat-insights.service';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatResolution } from './enums/chat-resolution.enum';
import { clusterThemes } from './utils/cluster-themes.util';
import { summarizeUnanswered } from './utils/summarize-unanswered.util';

export interface ClusterPassResult {
  readonly groups: number;
  readonly clusters: number;
}

const EMPTY_PASS: ClusterPassResult = { groups: 0, clusters: 0 };

/** varchar(64) on the column, and 32 hex characters is already unambiguous. */
const CLUSTER_KEY_LENGTH = 32;

/**
 * The semantic half of the unanswered grouping, run out of band.
 *
 * It exists because the deterministic pass cannot see that "earbuds",
 * "airpods" and "سماعات لاسلكية" are one demand signal — but the embeddings that
 * can are the ones branch 1 already ships, already free, and already
 * multilingual. A Gemini *generation* call per window was the alternative and
 * would have been a second AI dependency for grouping strings.
 *
 * Out of band for the same reason the knowledge sweeper is: an owner opening
 * their dashboard must not wait on an embedding provider, and if that provider
 * is down the feed degrades to the coarser grouping rather than to an error.
 */
@Injectable()
export class ChatClusteringService {
  private readonly logger = new Logger(ChatClusteringService.name);

  constructor(
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    private readonly insights: ChatInsightsService,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddings: EmbeddingProvider,
  ) {}

  /**
   * Re-derives one store's clustering from scratch, over the unreviewed
   * questions in the window.
   *
   * From scratch rather than incrementally on purpose: the grouping is a
   * function of the rows and nothing else, so it can be thrown away and rebuilt
   * at any time. That is the whole reason `clusterKey` is a nullable column on
   * the message rather than an entity with a freshness story of its own.
   */
  async clusterStore(storeId: string, since: Date): Promise<ClusterPassResult> {
    const rows = await this.insights.loadUnansweredInputs({
      storeId,
      since,
      includeReviewed: false,
    });

    // Deliberately blind to the keys already written: this pass is the authority
    // on them, and reading its own last answer back would make the grouping
    // depend on the order the nights ran in.
    const groups = summarizeUnanswered(
      rows.map((row) => ({ ...row, clusterKey: null })),
      { maxGroups: UNANSWERED_MAX_GROUPS },
    );
    if (groups.length < 2) {
      return EMPTY_PASS;
    }

    const vectors = await this.embeddings.embedDocuments(
      groups.map((group) => group.label),
    );
    const assignment = clusterThemes(
      groups.map((group, index) => ({
        key: group.key,
        occurrences: group.occurrences,
        vector: vectors[index],
      })),
      { threshold: UNANSWERED_CLUSTER_THRESHOLD },
    );

    const byCluster = new Map<string, string[]>();
    for (const group of groups) {
      const seed = assignment.get(group.key) ?? group.key;
      const clusterKey = hashClusterKey(seed);
      byCluster.set(clusterKey, [
        ...(byCluster.get(clusterKey) ?? []),
        ...group.messageIds,
      ]);
    }

    for (const [clusterKey, messageIds] of byCluster) {
      await this.messageRepository.update(
        { id: In(messageIds) },
        { clusterKey },
      );
    }

    return { groups: groups.length, clusters: byCluster.size };
  }

  /** Stores with something to cluster, so a quiet store costs no embedding call. */
  async listStoresWithUnanswered(since: Date): Promise<string[]> {
    const rows = await this.messageRepository
      .createQueryBuilder('answer')
      .select('DISTINCT answer.storeId', 'storeId')
      .where('answer.resolution = :resolution', {
        resolution: ChatResolution.Unanswered,
      })
      .andWhere('answer.createdAt >= :since', { since })
      .andWhere('answer.reviewedAt IS NULL')
      .getRawMany<{ storeId: string }>();

    return rows.map((row) => row.storeId);
  }
}

/**
 * The seed group's key, hashed so it fits the column whatever the shopper
 * typed. It is stable for the same seed, which is what lets a store be
 * re-clustered without every group changing identity.
 */
function hashClusterKey(seed: string): string {
  return createHash('sha256')
    .update(seed)
    .digest('hex')
    .slice(0, CLUSTER_KEY_LENGTH);
}
