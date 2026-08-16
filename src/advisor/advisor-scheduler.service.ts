import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '../redis/redis.service';
import { Store } from '../site-builder/entities/store.entity';
import { StoreStatus } from '../site-builder/enums/store-status.enum';
import { User } from '../users/entities/user.entity';
import {
  ADVISOR_LOCK_KEY,
  ADVISOR_LOCK_TTL_SECONDS,
} from './advisor.constants';
import { AdvisorBriefService } from './advisor-brief.service';
import { AdvisorMailService } from './advisor-mail.service';
import { AdvisorSettingsService } from './advisor-settings.service';
import { AdvisorBrief } from './entities/advisor-brief.entity';
import { AdvisorGenerator } from './enums/advisor-generator.enum';
import { getLocalDateString, getLocalHour } from './utils/timezone.util';

/**
 * The hourly pass that writes each store's brief when its own morning arrives.
 *
 * **Hourly, not daily**, because "7am" is 7am in Cairo, in Riyadh and in
 * Casablanca, and those are three different instants. The cron wakes up every
 * hour and asks each live store what time it is there.
 *
 * That makes a double write possible in principle — two instances, a retry, a
 * clock that steps back an hour at the end of daylight saving — and the answer
 * is `UQ_advisor_briefs_store_date` rather than the Redis lock. The lock stops
 * two instances doing the *work* twice; the index is what guarantees the
 * *result* is right, and it holds even when the lock does not.
 *
 * Why a cron and not a queue: the same answer `KnowledgeSweeper` gave. The work
 * is state in a table rather than a message — a missed hour is picked up by the
 * next one, and there is nothing to retry and nothing to lose.
 */
@Injectable()
export class AdvisorScheduler {
  private readonly logger = new Logger(AdvisorScheduler.name);
  private readonly instanceId = randomUUID();

  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly briefService: AdvisorBriefService,
    private readonly settingsService: AdvisorSettingsService,
    private readonly mailService: AdvisorMailService,
    private readonly redisService: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runHourly(): Promise<void> {
    const hasLock = await this.redisService.setIfAbsent(
      ADVISOR_LOCK_KEY,
      this.instanceId,
      ADVISOR_LOCK_TTL_SECONDS,
    );
    if (!hasLock) {
      return;
    }

    try {
      await this.generateDueBriefs();
    } catch (err) {
      this.logger.error(`Advisor pass failed: ${String(err)}`);
    } finally {
      await this.redisService.del(ADVISOR_LOCK_KEY).catch(() => undefined);
    }
  }

  /**
   * Every live store whose local clock has just reached its send hour.
   *
   * A **draft** store is skipped: it has no orders, no shoppers and no stock, so
   * its brief would be five empty sections and one confused owner.
   */
  async generateDueBriefs(now: Date = new Date()): Promise<number> {
    const stores = await this.storeRepository.find({
      where: { status: StoreStatus.Live },
    });

    let written = 0;

    for (const store of stores) {
      // One store's failure is reported and stepped over: a Gemini timeout on
      // store four must not cost store five its brief.
      const brief = await this.generateForStore(store, now).catch(
        (err: unknown) => {
          this.logger.warn(
            `Advisor brief failed for ${store.slug}: ${String(err)}`,
          );
          return null;
        },
      );

      if (brief) {
        written += 1;
      }
    }

    return written;
  }

  private async generateForStore(
    store: Store,
    now: Date,
  ): Promise<AdvisorBrief | null> {
    const settings = await this.settingsService.resolveForStore(store.id);
    if (!settings.isEnabled) {
      return null;
    }

    const timezone = this.settingsService.resolveTimezone(settings);
    if (getLocalHour(now, timezone) !== settings.sendHour) {
      return null;
    }

    const briefDate = getLocalDateString(now, timezone);
    const existing = await this.briefService.findByDate(store.id, briefDate);
    if (existing) {
      return null;
    }

    const brief = await this.briefService.generateForStore({
      store,
      generatedBy: AdvisorGenerator.Schedule,
      now,
    });
    if (!brief) {
      // Nothing worth saying today. No row, and no email — a daily "nothing to
      // report" is the notification that teaches an owner to ignore the rest.
      return null;
    }

    if (settings.emailEnabled) {
      // After the commit, and never fatal: a mail failure must not lose a
      // brief that is already written, which is the rule the orders module set
      // for its own notifications.
      await this.sendBrief(store, brief).catch((err: unknown) => {
        this.logger.warn(
          `Advisor mail failed for ${store.slug}: ${String(err)}`,
        );
      });
    }

    return brief;
  }

  /**
   * To the store **owner**, and only when their address is verified.
   *
   * Admins can read the brief in the dashboard; stock and cash advice is the
   * owner's business, and an unverified address is one nobody has proved
   * belongs to them.
   */
  private async sendBrief(store: Store, brief: AdvisorBrief): Promise<void> {
    const owner = await this.userRepository.findOne({
      where: { id: store.ownerId },
    });
    if (!owner?.isEmailVerified) {
      return;
    }

    await this.mailService.sendBriefEmail({
      to: owner.email,
      store,
      brief,
      insights: brief.insights ?? [],
    });

    await this.briefService.markEmailed(brief.id);
  }
}
