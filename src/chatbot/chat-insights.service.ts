import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PublicProductService } from '../catalog/public-product.service';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { StoreService } from '../site-builder/store.service';
import { MessageResponseDto } from '../users/dto/message-response.dto';
import {
  ADVISOR_THEME_LIMIT,
  CHAT_STATS_TOP_PRODUCTS,
  UNANSWERED_MAX_GROUPS,
  UNANSWERED_MAX_ROWS,
  UNANSWERED_WINDOW_DAYS,
} from './chatbot.constants';
import { ChatSessionQueryDto } from './dto/chat-session-query.dto';
import { ChatSessionDetailDto } from './dto/chat-session-detail.dto';
import { ChatSessionSummaryDto } from './dto/chat-session-summary.dto';
import { ChatProductMentionDto, ChatStatsDto } from './dto/chat-stats.dto';
import {
  UnansweredGroupDto,
  UnansweredTheme,
} from './dto/unanswered-group.dto';
import {
  ChatStatsQueryDto,
  UnansweredQueryDto,
} from './dto/unanswered-query.dto';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSession } from './entities/chat-session.entity';
import { ChatResolution } from './enums/chat-resolution.enum';
import { ChatRole } from './enums/chat-role.enum';
import {
  summarizeUnanswered,
  UnansweredGroup,
  UnansweredInput,
} from './utils/summarize-unanswered.util';

/** One unanswered question, as it comes back from the join. */
interface UnansweredRow {
  readonly id: string;
  readonly question: string;
  readonly askedAt: Date;
  readonly clusterKey: string | null;
  readonly reviewedAt: Date | null;
}

interface SessionExtrasRow {
  readonly sessionId: string;
  readonly unansweredCount: number;
}

interface SessionPreviewRow {
  readonly sessionId: string;
  readonly text: string;
}

interface MessageCountRow {
  readonly role: ChatRole;
  readonly resolution: ChatResolution | null;
  readonly count: number;
}

interface ProductMentionRow {
  readonly productId: string;
  readonly occurrences: number;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The owner's window onto what their assistant was asked, and the Daily AI
 * Advisor's only supported way in.
 *
 * It reads branch 2's rows and adds no conversation logic: nothing here calls a
 * model, and the one number that matters — `ChatResolution.Unanswered` — was
 * computed in code when the turn happened, which is why a feed built on it can
 * be trusted enough to reorder stock from.
 */
@Injectable()
export class ChatInsightsService {
  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepository: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    private readonly storeService: StoreService,
    private readonly publicProductService: PublicProductService,
  ) {}

  /* ── Transcripts ──────────────────────────────────────────────────────── */

  async listSessions(
    user: JwtPayload,
    query: ChatSessionQueryDto,
  ): Promise<PaginatedResponseDto<ChatSessionSummaryDto>> {
    const store = await this.storeService.resolveCallerStore(user);

    const builder = this.sessionRepository
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.user', 'user')
      .where('session.storeId = :storeId', { storeId: store.id });

    this.applySessionFilters(builder, query);

    const [sessions, total] = await builder
      // A session that has never been written to sorts last rather than first —
      // Postgres orders NULLs highest on a DESC sort by default.
      .orderBy('session.lastMessageAt', 'DESC', 'NULLS LAST')
      .addOrderBy('session.createdAt', 'DESC')
      .skip(query.offset)
      .take(query.limit)
      .getManyAndCount();

    const extras = await this.loadSessionExtras(sessions.map((row) => row.id));
    const items = sessions.map((session) =>
      ChatSessionSummaryDto.fromEntity(
        session,
        extras.get(session.id) ?? { preview: null, unansweredCount: 0 },
      ),
    );

    return PaginatedResponseDto.of(items, total, query);
  }

  async getSession(
    user: JwtPayload,
    sessionId: string,
  ): Promise<ChatSessionDetailDto> {
    const store = await this.storeService.resolveCallerStore(user);

    // Another store's session is a 404, never a 403: a 403 would confirm the id
    // exists, which is the rule every other resource in the project obeys.
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId, storeId: store.id },
      relations: { user: true },
    });
    if (!session) {
      throw new NotFoundException('Conversation not found');
    }

    const messages = await this.messageRepository.find({
      where: { sessionId: session.id },
      order: { createdAt: 'ASC' },
    });
    return ChatSessionDetailDto.fromEntities(session, messages);
  }

  /* ── The demand feed ──────────────────────────────────────────────────── */

  async listUnanswered(
    user: JwtPayload,
    query: UnansweredQueryDto,
  ): Promise<PaginatedResponseDto<UnansweredGroupDto>> {
    const store = await this.storeService.resolveCallerStore(user);
    const groups = await this.buildGroups({
      storeId: store.id,
      since: daysAgo(query.days),
      includeReviewed: query.includeReviewed,
    });

    const page = groups
      .slice(query.offset, query.offset + query.limit)
      .map((group) => UnansweredGroupDto.fromGroup(group));

    return PaginatedResponseDto.of(page, groups.length, query);
  }

  /**
   * Marks every occurrence of a theme reviewed, not just the row the owner
   * clicked: they stocked the thing once, and being asked about the other four
   * phrasings of it tomorrow is how a feed stops being read.
   */
  async reviewUnanswered(
    user: JwtPayload,
    messageId: string,
  ): Promise<MessageResponseDto> {
    const store = await this.storeService.resolveCallerStore(user);

    const target = await this.messageRepository.findOne({
      where: {
        id: messageId,
        storeId: store.id,
        resolution: ChatResolution.Unanswered,
      },
    });
    if (!target) {
      throw new NotFoundException('Unanswered question not found');
    }

    // The window is widened to reach the target when it is older than the
    // default one, so an owner working through a backlog is not told a row they
    // are looking at does not exist.
    const defaultSince = daysAgo(UNANSWERED_WINDOW_DAYS);
    const since =
      target.createdAt < defaultSince ? target.createdAt : defaultSince;

    const groups = await this.buildGroups({
      storeId: store.id,
      since,
      includeReviewed: true,
      maxGroups: UNANSWERED_MAX_ROWS,
    });
    const group = groups.find((entry) => entry.messageIds.includes(messageId));
    const messageIds = group?.messageIds ?? [messageId];

    const result = await this.messageRepository.update(
      { id: In(messageIds), storeId: store.id, reviewedAt: IsNull() },
      { reviewedAt: new Date() },
    );

    const reviewed = result.affected ?? 0;
    return {
      message:
        reviewed === 1
          ? 'Marked 1 question as reviewed'
          : `Marked ${reviewed} questions as reviewed`,
    };
  }

  /**
   * **The method the Daily AI Advisor calls**, and the reason this branch ships
   * before the Advisor does.
   *
   * Store-scoped, reviewed rows excluded, ordered by occurrences. The Advisor
   * turns a row into a sentence; it does not re-derive the grouping and it does
   * not read `ChatMessage` itself.
   */
  async listUnansweredThemes({
    storeId,
    since,
    limit = ADVISOR_THEME_LIMIT,
  }: {
    storeId: string;
    since: Date;
    limit?: number;
  }): Promise<UnansweredTheme[]> {
    const groups = await this.buildGroups({
      storeId,
      since,
      includeReviewed: false,
    });

    return groups.slice(0, limit).map((group) => ({
      label: group.label,
      occurrences: group.occurrences,
      exampleQuestion: group.exampleQuestion,
      lastAskedAt: group.lastAskedAt,
    }));
  }

  /* ── Stats ────────────────────────────────────────────────────────────── */

  async getStats(
    user: JwtPayload,
    query: ChatStatsQueryDto,
  ): Promise<ChatStatsDto> {
    const store = await this.storeService.resolveCallerStore(user);
    const since = daysAgo(query.days);

    const [sessions, counts, mentions, themes] = await Promise.all([
      this.countSessions(store.id, since),
      this.countMessages(store.id, since),
      this.loadTopProducts(store.id, since),
      this.buildGroups({ storeId: store.id, since, includeReviewed: false }),
    ]);

    return {
      days: query.days,
      from: since,
      sessions,
      messages: counts.reduce((sum, row) => sum + row.count, 0),
      questions: counts
        .filter((row) => row.role === ChatRole.User)
        .reduce((sum, row) => sum + row.count, 0),
      byResolution: tallyResolutions(counts),
      unansweredThemes: themes.length,
      topProducts: mentions,
    };
  }

  /* ── The shared pipeline ──────────────────────────────────────────────── */

  /**
   * Loads the window's unanswered questions and groups them.
   *
   * The deterministic pass runs always; the nightly semantic pass has already
   * written its merge to `clusterKey`, and `summarizeUnanswered` prefers it when
   * it is there. So an unavailable embedding service costs a coarser grouping
   * rather than an error, and the read path never calls an AI provider.
   */
  private async buildGroups({
    storeId,
    since,
    includeReviewed,
    maxGroups = UNANSWERED_MAX_GROUPS,
  }: {
    storeId: string;
    since: Date;
    includeReviewed: boolean;
    maxGroups?: number;
  }): Promise<UnansweredGroup[]> {
    const rows = await this.loadUnansweredInputs({
      storeId,
      since,
      includeReviewed,
    });
    return summarizeUnanswered(rows, { maxGroups });
  }

  /**
   * The question behind every `unanswered` reply in the window.
   *
   * An inner join on `questionId` rather than a window function over the whole
   * transcript: the resolution lives on the answer and the text an owner needs
   * is on the question, and the link between them was written when the turn
   * happened.
   *
   * Public because the nightly clustering pass reads exactly this set — one
   * predicate for what counts as an unanswered question, not two that can
   * drift.
   */
  async loadUnansweredInputs({
    storeId,
    since,
    includeReviewed,
  }: {
    storeId: string;
    since: Date;
    includeReviewed: boolean;
  }): Promise<UnansweredInput[]> {
    const builder = this.messageRepository
      .createQueryBuilder('answer')
      .innerJoin(ChatMessage, 'question', 'question.id = answer.questionId')
      .select('answer.id', 'id')
      .addSelect('question.text', 'question')
      .addSelect('answer.createdAt', 'askedAt')
      .addSelect('answer.clusterKey', 'clusterKey')
      .addSelect('answer.reviewedAt', 'reviewedAt')
      .where('answer.storeId = :storeId', { storeId })
      .andWhere('answer.resolution = :resolution', {
        resolution: ChatResolution.Unanswered,
      })
      .andWhere('answer.createdAt >= :since', { since });

    if (!includeReviewed) {
      builder.andWhere('answer.reviewedAt IS NULL');
    }

    const rows = await builder
      .orderBy('answer.createdAt', 'DESC')
      .limit(UNANSWERED_MAX_ROWS)
      .getRawMany<UnansweredRow>();

    return toInputs(rows);
  }

  private applySessionFilters(
    builder: SelectQueryBuilder<ChatSession>,
    query: ChatSessionQueryDto,
  ): void {
    if (query.from) {
      builder.andWhere('session.lastMessageAt >= :from', { from: query.from });
    }
    if (query.to) {
      builder.andWhere('session.lastMessageAt <= :to', { to: query.to });
    }
    if (query.isSignedIn !== undefined) {
      builder.andWhere(
        query.isSignedIn
          ? 'session.userId IS NOT NULL'
          : 'session.userId IS NULL',
      );
    }
    if (query.hasUnanswered !== undefined) {
      const exists = `EXISTS (SELECT 1 FROM chat_messages m
                               WHERE m."sessionId" = session.id
                                 AND m.resolution = :unanswered)`;
      builder.andWhere(query.hasUnanswered ? exists : `NOT ${exists}`, {
        unanswered: ChatResolution.Unanswered,
      });
    }
    if (query.search?.trim()) {
      builder.andWhere(
        `EXISTS (SELECT 1 FROM chat_messages m
                  WHERE m."sessionId" = session.id
                    AND m.text ILIKE :search)`,
        { search: `%${query.search.trim()}%` },
      );
    }
  }

  /**
   * The opening question and the unanswered count for a page of sessions.
   *
   * Two grouped queries for the page rather than a subselect per row — the same
   * shape `Category.productCount` uses, and the same upgrade path if it ever
   * profiles badly.
   */
  private async loadSessionExtras(
    sessionIds: readonly string[],
  ): Promise<Map<string, { preview: string | null; unansweredCount: number }>> {
    const extras = new Map<
      string,
      { preview: string | null; unansweredCount: number }
    >();
    if (sessionIds.length === 0) {
      return extras;
    }

    const ids = [...sessionIds];
    const [counts, previews] = await Promise.all([
      this.messageRepository.manager.query<SessionExtrasRow[]>(
        `SELECT "sessionId",
                COUNT(*) FILTER (WHERE resolution = $2)::int AS "unansweredCount"
           FROM chat_messages
          WHERE "sessionId" = ANY($1)
          GROUP BY "sessionId"`,
        [ids, ChatResolution.Unanswered],
      ),
      this.messageRepository.manager.query<SessionPreviewRow[]>(
        `SELECT DISTINCT ON ("sessionId") "sessionId", text
           FROM chat_messages
          WHERE "sessionId" = ANY($1) AND role = $2
          ORDER BY "sessionId", "createdAt" ASC`,
        [ids, ChatRole.User],
      ),
    ]);

    for (const id of ids) {
      extras.set(id, { preview: null, unansweredCount: 0 });
    }
    for (const row of counts) {
      const entry = extras.get(row.sessionId);
      if (entry) {
        extras.set(row.sessionId, {
          ...entry,
          unansweredCount: row.unansweredCount,
        });
      }
    }
    for (const row of previews) {
      const entry = extras.get(row.sessionId);
      if (entry) {
        extras.set(row.sessionId, { ...entry, preview: row.text });
      }
    }
    return extras;
  }

  private async countSessions(storeId: string, since: Date): Promise<number> {
    return this.sessionRepository
      .createQueryBuilder('session')
      .where('session.storeId = :storeId', { storeId })
      .andWhere('session.lastMessageAt >= :since', { since })
      .getCount();
  }

  private async countMessages(
    storeId: string,
    since: Date,
  ): Promise<MessageCountRow[]> {
    return this.messageRepository.manager.query<MessageCountRow[]>(
      `SELECT role, resolution, COUNT(*)::int AS count
         FROM chat_messages
        WHERE "storeId" = $1 AND "createdAt" >= $2
        GROUP BY role, resolution`,
      [storeId, since],
    );
  }

  /**
   * The products the assistant put in front of shoppers most often, from the
   * ids every answered turn recorded.
   *
   * Hydrated through `loadCardsByIds`, which re-applies the storefront
   * predicates — so a product archived since it was mentioned drops out of the
   * list rather than being named in a dashboard that no longer sells it.
   */
  private async loadTopProducts(
    storeId: string,
    since: Date,
  ): Promise<ChatProductMentionDto[]> {
    const rows = await this.messageRepository.manager.query<
      ProductMentionRow[]
    >(
      `SELECT value AS "productId", COUNT(*)::int AS occurrences
         FROM chat_messages,
              LATERAL jsonb_array_elements_text(sources -> 'productIds')
        WHERE "storeId" = $1
          AND "createdAt" >= $2
          AND sources IS NOT NULL
        GROUP BY value
        ORDER BY occurrences DESC
        LIMIT $3`,
      [storeId, since, CHAT_STATS_TOP_PRODUCTS],
    );
    if (rows.length === 0) {
      return [];
    }

    const products = await this.publicProductService.loadCardsByIds(
      storeId,
      rows.map((row) => row.productId),
    );
    const byId = new Map(products.map((product) => [product.id, product]));

    return rows
      .filter((row) => byId.has(row.productId))
      .map((row) => ({
        productId: row.productId,
        title: byId.get(row.productId)!.title,
        slug: byId.get(row.productId)!.slug,
        occurrences: row.occurrences,
      }));
  }
}

function toInputs(rows: readonly UnansweredRow[]): UnansweredInput[] {
  return rows.map((row) => ({
    id: row.id,
    question: row.question,
    askedAt: row.askedAt,
    clusterKey: row.clusterKey,
    isReviewed: row.reviewedAt !== null,
  }));
}

/** Zero-filled, so a client can render a bar per state without a null check. */
function tallyResolutions(
  rows: readonly MessageCountRow[],
): Record<ChatResolution, number> {
  const tally = Object.values(ChatResolution).reduce(
    (accumulator, resolution) => ({ ...accumulator, [resolution]: 0 }),
    {} as Record<ChatResolution, number>,
  );

  for (const row of rows) {
    if (row.resolution !== null) {
      tally[row.resolution] += row.count;
    }
  }
  return tally;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * MILLISECONDS_PER_DAY);
}
