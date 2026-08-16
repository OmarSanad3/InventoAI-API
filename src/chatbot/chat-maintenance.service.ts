import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '../redis/redis.service';
import {
  CHAT_MAINTENANCE_LOCK_KEY,
  CHAT_MAINTENANCE_LOCK_TTL_SECONDS,
  CHAT_RETENTION_DAYS,
  UNANSWERED_WINDOW_DAYS,
} from './chatbot.constants';
import { ChatClusteringService } from './chat-clustering.service';
import { ChatSession } from './entities/chat-session.entity';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The chatbot's nightly housekeeping: re-cluster the demand feed, then drop the
 * transcripts that have aged out.
 *
 * It runs on the same schedule as the knowledge base's reconcile rather than
 * inside it, because the dependency between the two modules runs one way only —
 * `ChatbotModule` imports `KnowledgeModule` and nothing there reaches back, and
 * a `KnowledgeSweeper` that knew how to cluster chat messages would break that
 * for the sake of sharing a cron expression.
 *
 * Neither half is fatal to the other, and neither is fatal to the process: a
 * missed night is picked up by the next one, which is the same property that
 * made `@nestjs/schedule` the right answer for the sweeper.
 */
@Injectable()
export class ChatMaintenanceService {
  private readonly logger = new Logger(ChatMaintenanceService.name);
  private readonly instanceId = randomUUID();

  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepository: Repository<ChatSession>,
    private readonly clustering: ChatClusteringService,
    private readonly redisService: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runNightly(): Promise<void> {
    const hasLock = await this.redisService.setIfAbsent(
      CHAT_MAINTENANCE_LOCK_KEY,
      this.instanceId,
      CHAT_MAINTENANCE_LOCK_TTL_SECONDS,
    );
    if (!hasLock) {
      return;
    }

    try {
      await this.clusterUnanswered();
      await this.applyRetention();
    } finally {
      await this.redisService
        .del(CHAT_MAINTENANCE_LOCK_KEY)
        .catch(() => undefined);
    }
  }

  /**
   * One store's failure is reported and stepped over: an embedding call that
   * rate-limits on store four must not cost store five its grouping.
   */
  async clusterUnanswered(): Promise<void> {
    const since = daysAgo(UNANSWERED_WINDOW_DAYS);

    try {
      const storeIds = await this.clustering.listStoresWithUnanswered(since);
      for (const storeId of storeIds) {
        const result = await this.clustering
          .clusterStore(storeId, since)
          .catch((err: unknown) => {
            this.logger.warn(
              `Unanswered clustering failed for ${storeId}: ${String(err)}`,
            );
            return null;
          });

        if (result && result.groups > 0) {
          this.logger.log(
            `Clustered ${storeId}: ${result.groups} groups into ${result.clusters} themes`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`Unanswered clustering pass failed: ${String(err)}`);
    }
  }

  /**
   * Deletes sessions with no activity for `CHAT_RETENTION_DAYS`, messages and
   * all — the FK is `ON DELETE CASCADE`, so the transcript goes with its
   * session in one statement.
   *
   * A session bound to a customer is kept exactly as long as an anonymous one.
   * There is no reason for the assistant's memory of a shopper to outlive the
   * shopper's own interest in it, and a transcript holds whatever they typed.
   */
  async applyRetention(): Promise<void> {
    const cutoff = daysAgo(CHAT_RETENTION_DAYS);

    try {
      const result = await this.sessionRepository
        .createQueryBuilder()
        .delete()
        .from(ChatSession)
        // A session that took a message is judged on its last one; one that
        // never did is judged on when it was opened, or an abandoned empty
        // session would live forever.
        .where('COALESCE("lastMessageAt", "createdAt") < :cutoff', { cutoff })
        .execute();

      if (result.affected) {
        this.logger.log(
          `Retention removed ${result.affected} conversations older than ${CHAT_RETENTION_DAYS} days`,
        );
      }
    } catch (err) {
      this.logger.error(`Chat retention pass failed: ${String(err)}`);
    }
  }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * MILLISECONDS_PER_DAY);
}
