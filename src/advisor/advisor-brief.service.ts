import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store } from '../site-builder/entities/store.entity';
import {
  INSIGHT_SUPPRESSION_DAYS,
  MAX_INSIGHTS_PER_BRIEF,
} from './advisor.constants';
import { AdvisorNarrator } from './advisor-narrator.service';
import { AdvisorSettingsService } from './advisor-settings.service';
import { CalendarSignalCollector } from './collectors/calendar-signal.collector';
import { DemandGapCollector } from './collectors/demand-gap.collector';
import { SalesSignalCollector } from './collectors/sales-signal.collector';
import { StockSignalCollector } from './collectors/stock-signal.collector';
import { WeatherSignalCollector } from './collectors/weather-signal.collector';
import type {
  CollectorContext,
  SignalCollector,
} from './collectors/signal-collector.interface';
import { AdvisorBrief } from './entities/advisor-brief.entity';
import { AdvisorInsight } from './entities/advisor-insight.entity';
import { AdvisorGenerator } from './enums/advisor-generator.enum';
import { AdvisorInsightStatus } from './enums/advisor-insight-status.enum';
import type { AdvisorSignal } from './types/advisor-signal.type';
import { rankInsights } from './utils/rank-insights.util';
import { getLocalDateString, subtractDays } from './utils/timezone.util';

export interface GenerateBriefCommand {
  readonly store: Store;
  readonly generatedBy: AdvisorGenerator;
  /** Passed rather than read, so a run is replayable and testable. */
  readonly now?: Date;
}

/**
 * The writer: collect, suppress, rank, narrate, save.
 *
 * Everything ordered and everything deterministic up to the narration, which is
 * the only step that may produce different words for the same facts — and the
 * only step allowed to fail without consequence.
 */
@Injectable()
export class AdvisorBriefService {
  private readonly logger = new Logger(AdvisorBriefService.name);
  private readonly collectors: readonly SignalCollector[];

  constructor(
    @InjectRepository(AdvisorBrief)
    private readonly briefRepository: Repository<AdvisorBrief>,
    @InjectRepository(AdvisorInsight)
    private readonly insightRepository: Repository<AdvisorInsight>,
    private readonly settingsService: AdvisorSettingsService,
    private readonly narrator: AdvisorNarrator,
    stockCollector: StockSignalCollector,
    salesCollector: SalesSignalCollector,
    demandGapCollector: DemandGapCollector,
    calendarCollector: CalendarSignalCollector,
    weatherCollector: WeatherSignalCollector,
  ) {
    this.collectors = [
      stockCollector,
      salesCollector,
      demandGapCollector,
      calendarCollector,
      weatherCollector,
    ];
  }

  /**
   * Writes today's brief for one store, replacing any brief already written for
   * the same local day.
   *
   * Returns `null` when there is nothing to say. A daily "nothing to report" is
   * a notification an owner learns to ignore, and that is the notification that
   * also hides the day something mattered.
   */
  async generateForStore({
    store,
    generatedBy,
    now = new Date(),
  }: GenerateBriefCommand): Promise<AdvisorBrief | null> {
    const settings = await this.settingsService.resolveForStore(store.id);
    const timezone = this.settingsService.resolveTimezone(settings);
    const briefDate = getLocalDateString(now, timezone);

    const signals = await this.collectSignals({
      store,
      settings,
      timezone,
      now,
    });
    const kept = rankInsights(
      await this.dropSuppressed({ storeId: store.id, signals, now, briefDate }),
      MAX_INSIGHTS_PER_BRIEF,
    );
    if (kept.length === 0) {
      return null;
    }

    const narrated = await this.narrator.narrate({
      signals: kept,
      storeName: store.name,
      locale: store.locale,
      currency: store.currency,
    });

    // Statuses the owner already set today, so a regeneration at 11:00 does not
    // undo a dismissal at 09:00.
    const carriedStatuses = await this.loadStatusesForDay(store.id, briefDate);

    return this.briefRepository.manager.transaction(async (manager) => {
      // Replace rather than update: the insights of a brief are written in one
      // statement and the unique index is the only thing that has to hold.
      await manager.delete(AdvisorBrief, { storeId: store.id, briefDate });

      const brief = await manager.save(
        manager.create(AdvisorBrief, {
          storeId: store.id,
          briefDate,
          headline: narrated.headline,
          insightCount: kept.length,
          generatedBy,
          narratorStatus: narrated.status,
          emailedAt: null,
        }),
      );

      const insights = kept.map((signal, index) => {
        const carried = carriedStatuses.get(signal.dedupeKey);
        return manager.create(AdvisorInsight, {
          briefId: brief.id,
          storeId: store.id,
          kind: signal.kind,
          severity: signal.severity,
          dedupeKey: signal.dedupeKey,
          title: narrated.lines[index].title,
          body: narrated.lines[index].body,
          payload: signal.payload as unknown as Record<string, unknown>,
          status: carried?.status ?? AdvisorInsightStatus.New,
          statusChangedAt: carried?.statusChangedAt ?? null,
          position: index,
        });
      });
      await manager.save(insights);

      brief.insights = insights;
      return brief;
    });
  }

  /**
   * Every collector, in parallel, and a failure costs its own section.
   *
   * A brief with four sections instead of five is a brief. An exception that
   * reaches the scheduler is a store with no brief at all and an owner with no
   * way to know why — which is the worse of the two by a long way.
   */
  private async collectSignals(
    context: CollectorContext,
  ): Promise<AdvisorSignal[]> {
    const results = await Promise.allSettled(
      this.collectors.map((collector) => collector.collect(context)),
    );

    const signals: AdvisorSignal[] = [];

    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        signals.push(...result.value);
        continue;
      }
      this.logger.warn(
        `Collector "${this.collectors[index].name}" failed for store ` +
          `${context.store.id}: ${String(result.reason)}`,
      );
    }

    return signals;
  }

  /**
   * Drops advice the owner has already dealt with.
   *
   * Tomorrow's collectors still produce the signal — the stock is still low —
   * so the filter is what keeps a brief from nagging. The window is a week: new
   * enough that a real change re-surfaces, long enough that "I know" means
   * something.
   *
   * `acted` is suppressed alongside `dismissed`, and for a better reason: an
   * owner who ordered more stock on Monday will not see it arrive until Friday,
   * and being told to order it again on Tuesday is how a brief loses its
   * reader.
   *
   * **Today's own brief is excluded from the lookup**, and that is load-bearing
   * rather than an optimisation. A regeneration deletes today's insights and
   * writes them again, so if a line dismissed at 09:00 were suppressed at 11:00
   * it would vanish — taking with it the only record that it was ever
   * dismissed, and reappearing tomorrow as though nothing had happened. Instead
   * it stays in today's brief carrying its `dismissed` status (see
   * `loadStatusesForDay`), and is dropped from tomorrow's.
   */
  private async dropSuppressed({
    storeId,
    signals,
    now,
    briefDate,
  }: {
    storeId: string;
    signals: readonly AdvisorSignal[];
    now: Date;
    briefDate: string;
  }): Promise<AdvisorSignal[]> {
    if (signals.length === 0) {
      return [];
    }

    const handled = await this.insightRepository
      .createQueryBuilder('insight')
      .innerJoin('insight.brief', 'brief')
      .select('insight.dedupeKey', 'dedupeKey')
      .where('insight.storeId = :storeId', { storeId })
      .andWhere('insight.dedupeKey IN (:...keys)', {
        keys: signals.map((signal) => signal.dedupeKey),
      })
      .andWhere('insight.status IN (:...statuses)', {
        statuses: [AdvisorInsightStatus.Dismissed, AdvisorInsightStatus.Acted],
      })
      .andWhere('insight.statusChangedAt > :since', {
        since: subtractDays(now, INSIGHT_SUPPRESSION_DAYS),
      })
      .andWhere('brief.briefDate < :briefDate', { briefDate })
      .getRawMany<{ dedupeKey: string }>();

    const suppressed = new Set(handled.map((row) => row.dedupeKey));
    return signals.filter((signal) => !suppressed.has(signal.dedupeKey));
  }

  /** The statuses of today's brief, keyed the way a new one will be. */
  private async loadStatusesForDay(
    storeId: string,
    briefDate: string,
  ): Promise<
    Map<string, { status: AdvisorInsightStatus; statusChangedAt: Date | null }>
  > {
    const existing = await this.insightRepository.find({
      where: { storeId, brief: { briefDate } },
      relations: { brief: true },
    });

    return new Map(
      existing
        .filter((insight) => insight.status !== AdvisorInsightStatus.New)
        .map((insight) => [
          insight.dedupeKey,
          {
            status: insight.status,
            statusChangedAt: insight.statusChangedAt,
          },
        ]),
    );
  }

  /** Used by the scheduler to skip a store that already has today's brief. */
  async findByDate(
    storeId: string,
    briefDate: string,
  ): Promise<AdvisorBrief | null> {
    return this.briefRepository.findOne({ where: { storeId, briefDate } });
  }

  /** Stamped after the mail goes out, so a resend is visible rather than silent. */
  async markEmailed(briefId: string): Promise<void> {
    await this.briefRepository.update(
      { id: briefId },
      { emailedAt: new Date() },
    );
  }
}
