import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { RedisService } from '../redis/redis.service';
import { KnowledgeIndexer } from './knowledge-indexer.service';
import {
  KNOWLEDGE_SWEEP_INTERVAL_SECONDS,
  SWEEP_LOCK_KEY,
  SWEEP_LOCK_TTL_SECONDS,
} from './knowledge.constants';

const MILLISECONDS = 1000;

/**
 * The out-of-band half of the freshness contract: a source write flips a flag,
 * and this picks the flag up later.
 *
 * `@nestjs/schedule` rather than a queue, because the work is **state in a
 * table, not a message**. A crashed run, a restart, a deploy — the next sweep
 * finds the same stale rows and does the same work, with no retry policy, no
 * dead-letter queue and nothing to lose. A queue is the right upgrade when a job
 * needs delays, priorities or per-job progress; this one needs none of them.
 */
@Injectable()
export class KnowledgeSweeper {
  private readonly logger = new Logger(KnowledgeSweeper.name);
  private readonly instanceId = randomUUID();

  /** In-process guard. The Redis lock below covers the multi-instance case. */
  private isSweeping = false;

  constructor(
    private readonly indexer: KnowledgeIndexer,
    private readonly redisService: RedisService,
  ) {}

  @Interval(KNOWLEDGE_SWEEP_INTERVAL_SECONDS * MILLISECONDS)
  async sweep(): Promise<void> {
    if (this.isSweeping) {
      return;
    }
    this.isSweeping = true;

    try {
      const hasLock = await this.redisService.setIfAbsent(
        SWEEP_LOCK_KEY,
        this.instanceId,
        SWEEP_LOCK_TTL_SECONDS,
      );
      if (!hasLock) {
        return;
      }

      const result = await this.indexer.indexPending();
      if (result.composed > 0) {
        this.logger.log(
          `Indexed ${result.embedded}, unchanged ${result.unchanged}, removed ${result.removed}, failed ${result.failed}`,
        );
      }
    } catch (err) {
      this.logger.error(`Knowledge sweep failed: ${String(err)}`);
    } finally {
      this.isSweeping = false;
      await this.redisService.del(SWEEP_LOCK_KEY).catch(() => undefined);
    }
  }

  /**
   * The net under the subscriber's known gap, and under anything a seed, a
   * migration or a manual `UPDATE` did behind the ORM's back. It re-derives
   * every store's document set and marks the survivors stale; because an
   * unchanged document's hash does not move, the sweep that follows costs close
   * to zero embedding calls.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async reconcileAll(): Promise<void> {
    try {
      const storeIds = await this.indexer.listStoreIds();
      for (const storeId of storeIds) {
        const result = await this.indexer.reconcile(storeId);
        this.logger.log(
          `Reconciled ${storeId}: +${result.added} -${result.removed} =${result.kept}`,
        );
      }
    } catch (err) {
      this.logger.error(`Knowledge reconcile failed: ${String(err)}`);
    }
  }
}
