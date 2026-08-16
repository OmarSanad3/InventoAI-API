import { CALENDAR_LOOKAHEAD_DAYS } from '../advisor.constants';
import {
  COUNTRY_EVENTS,
  GLOBAL_EVENTS,
  HIJRI_EVENTS,
  type CalendarEventDefinition,
  type CalendarTag,
} from '../calendar-events.constant';
import { getLocalDateString } from './timezone.util';

/**
 * What is coming up, and how soon.
 *
 * The whole thing is a walk over the next few weeks of the store's own
 * calendar, asking `Intl` what each day is. That is cheap — at most 29
 * iterations of two formats — and it is the only implementation that gets
 * Ramadan right without a dependency, a table of years, or an API key.
 */

export interface UpcomingEvent {
  key: string;
  name: string;
  /** `YYYY-MM-DD` in the store's timezone. */
  startsOn: string;
  daysUntil: number;
  tags: readonly CalendarTag[];
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Events starting within `lookaheadDays`, soonest first.
 *
 * `daysUntil: 0` means today, which is late for stock advice and exactly right
 * for "move it to the homepage".
 */
export function findUpcomingEvents({
  now,
  timezone,
  countryCode,
  lookaheadDays = CALENDAR_LOOKAHEAD_DAYS,
}: {
  now: Date;
  timezone: string;
  countryCode?: string | null;
  lookaheadDays?: number;
}): UpcomingEvent[] {
  const definitions = collectDefinitions(countryCode);
  const found = new Map<string, UpcomingEvent>();

  for (let offset = 0; offset <= lookaheadDays; offset += 1) {
    const instant = new Date(now.getTime() + offset * MILLISECONDS_PER_DAY);
    const gregorian = getGregorianParts(instant, timezone);
    const hijri = getHijriParts(instant, timezone);

    for (const definition of definitions) {
      // The first day the event lands on wins: a walk forwards finds the next
      // occurrence, and a second hit is the same event a year later.
      if (found.has(definition.key)) {
        continue;
      }
      if (!matches(definition, gregorian, hijri)) {
        continue;
      }

      found.set(definition.key, {
        key: definition.key,
        name: definition.name,
        startsOn: getLocalDateString(instant, timezone),
        daysUntil: offset,
        tags: definition.tags,
      });
    }
  }

  return [...found.values()].sort((a, b) => a.daysUntil - b.daysUntil);
}

/**
 * The store's categories that plausibly belong to an event, matched on the
 * event's tags. A hint for the sentence, never a filter on the event.
 */
export function matchCategoriesToEvent<T extends { id: string; name: string }>(
  categories: readonly T[],
  tags: readonly CalendarTag[],
): T[] {
  return categories.filter((category) => {
    const name = category.name.toLowerCase();
    return tags.some((tag) => name.includes(tag.toLowerCase()));
  });
}

function collectDefinitions(
  countryCode?: string | null,
): CalendarEventDefinition[] {
  const country = countryCode?.trim().toUpperCase();
  const local = country ? (COUNTRY_EVENTS[country] ?? []) : [];
  return [...HIJRI_EVENTS, ...GLOBAL_EVENTS, ...local];
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday. Only the Gregorian parts carry it. */
  weekday?: number;
}

function matches(
  definition: CalendarEventDefinition,
  gregorian: DateParts,
  hijri: DateParts,
): boolean {
  switch (definition.type) {
    case 'fixed':
      return (
        gregorian.month === definition.month && gregorian.day === definition.day
      );
    case 'nth-weekday':
      return (
        gregorian.month === definition.month &&
        gregorian.weekday === definition.weekday &&
        nthOfMonth(gregorian.day) === definition.nth
      );
    case 'hijri':
      return (
        hijri.month === definition.hijriMonth &&
        hijri.day === definition.hijriDay
      );
  }
}

/** Which occurrence of its weekday a day-of-month is: the 24th is the 4th. */
function nthOfMonth(dayOfMonth: number): number {
  return Math.floor((dayOfMonth - 1) / 7) + 1;
}

function getGregorianParts(instant: Date, timezone: string): DateParts {
  const parts = readParts(instant, {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    weekday: parts.weekday,
  };
}

/**
 * The Umm al-Qura date for an instant. `numeric` month and day come back as
 * plain integers — verified against 1 Ramadan and both Eids before this was
 * written, because a calendar that is quietly a month out is the worst kind of
 * bug to have in a brief.
 */
function getHijriParts(instant: Date, timezone: string): DateParts {
  const parts = readParts(instant, {
    calendar: 'islamic-umalqura',
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  return { year: parts.year, month: parts.month, day: parts.day };
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function readParts(
  instant: Date,
  options: Intl.DateTimeFormatOptions,
): { year: number; month: number; day: number; weekday: number } {
  const formatted = new Intl.DateTimeFormat('en-US', options).formatToParts(
    instant,
  );
  const values = new Map(formatted.map((part) => [part.type, part.value]));

  return {
    year: Number.parseInt(values.get('year') ?? '0', 10),
    month: Number.parseInt(values.get('month') ?? '0', 10),
    day: Number.parseInt(values.get('day') ?? '0', 10),
    weekday: WEEKDAY_INDEX[values.get('weekday') ?? ''] ?? -1,
  };
}
