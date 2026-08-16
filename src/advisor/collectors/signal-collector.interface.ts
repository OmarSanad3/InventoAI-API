import type { AdvisorSettings } from '../entities/advisor-settings.entity';
import type { Store } from '../../site-builder/entities/store.entity';
import type { AdvisorSignal } from '../types/advisor-signal.type';

/** Everything a collector is allowed to know about the store it runs for. */
export interface CollectorContext {
  readonly store: Store;
  readonly settings: AdvisorSettings;
  /** The zone every window in this run is measured in. */
  readonly timezone: string;
  /** The instant the run started. Passed rather than read, so a run is replayable. */
  readonly now: Date;
}

/**
 * One source of advice.
 *
 * Adding a signal to the brief is adding a class that implements this — no
 * change to the writer, the ranker, the narrator or the routes. That is the
 * whole reason the seam exists.
 *
 * A collector **may throw**. `AdvisorBriefService` runs them under
 * `Promise.allSettled`, so a failure costs its own section and never the brief:
 * four sections instead of five is a brief, and an exception that reaches the
 * cron is a store with no brief and no way to know why.
 */
export interface SignalCollector {
  /** Named for the log line a failure produces. */
  readonly name: string;
  collect(context: CollectorContext): Promise<AdvisorSignal[]>;
}
