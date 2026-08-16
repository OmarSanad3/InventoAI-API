/**
 * The store's clock.
 *
 * Every window in this feature — "today", "the last 7 days", "is it 7am yet" —
 * is a question about the store's local calendar, not the server's. A shop in
 * Cairo must not have its day cut at 02:00 because the container runs on UTC.
 *
 * All of it goes through `Intl`, which is the only thing in Node that knows the
 * IANA database, and none of it needs a dependency.
 */

/** The parts of a wall clock, in one zone, as numbers. */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
}

type PartKey = 'year' | 'month' | 'day' | 'hour';

/**
 * `Intl` formats to strings, so this is the one place that parses them back.
 * `hourCycle: 'h23'` matters: the default gives `24` for midnight in some
 * locales, and `sendHour: 0` would then never match.
 */
export function getZonedParts(instant: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });

  const parts = new Map(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );

  const read = (key: PartKey): number =>
    Number.parseInt(parts.get(key) ?? '0', 10);

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
  };
}

/**
 * The store's calendar day as `YYYY-MM-DD` — what `AdvisorBrief.briefDate`
 * holds, and what makes "one brief per store per day" mean the store's day.
 */
export function getLocalDateString(instant: Date, timezone: string): string {
  const { year, month, day } = getZonedParts(instant, timezone);
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

/** The hour on the store's wall clock, 0–23. */
export function getLocalHour(instant: Date, timezone: string): number {
  return getZonedParts(instant, timezone).hour;
}

/**
 * `Intl` validates a zone by throwing, so this is the boundary that turns that
 * into a boolean. The DTO's `@IsTimeZone()` runs the same check; this one
 * guards a value that was already stored — a zone can be dropped from the
 * database between releases, and a brief must not die of it.
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** `days` before `instant`. Plain arithmetic: a UTC instant has no zone. */
export function subtractDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() - days * MILLISECONDS_PER_DAY);
}

/** Whole days between two instants, rounded down and never negative. */
export function daysBetween(earlier: Date, later: Date): number {
  const elapsed = later.getTime() - earlier.getTime();
  return elapsed <= 0 ? 0 : Math.floor(elapsed / MILLISECONDS_PER_DAY);
}
