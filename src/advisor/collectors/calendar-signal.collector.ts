import { Injectable } from '@nestjs/common';
import { CategoryService } from '../../catalog/category.service';
import { CALENDAR_LOOKAHEAD_DAYS } from '../advisor.constants';
import { AdvisorInsightKind } from '../enums/advisor-insight-kind.enum';
import { AdvisorSeverity } from '../enums/advisor-severity.enum';
import type { AdvisorSignal } from '../types/advisor-signal.type';
import {
  findUpcomingEvents,
  matchCategoriesToEvent,
} from '../utils/calendar.util';
import type {
  CollectorContext,
  SignalCollector,
} from './signal-collector.interface';

/**
 * What is coming up: Ramadan, Eid, back-to-school, Black Friday.
 *
 * The Hijri dates come from Node's own ICU, so this collector makes no network
 * call, needs no key and works in an offline container — see
 * `calendar-events.constant.ts` for why that is worth insisting on, and for the
 * one caveat (Umm al-Qura is calculated, and the announced start of Ramadan can
 * differ by a day; the brief says "in about three weeks", never a countdown).
 *
 * The store's own categories are matched against the event's tags so the
 * sentence can name them. A match is a **hint, never a filter**: an event no
 * category matches is still worth telling an owner about, and the categories
 * they have are not the categories they could add.
 */
@Injectable()
export class CalendarSignalCollector implements SignalCollector {
  readonly name = 'calendar';

  constructor(private readonly categoryService: CategoryService) {}

  async collect({
    store,
    settings,
    timezone,
    now,
  }: CollectorContext): Promise<AdvisorSignal[]> {
    const events = findUpcomingEvents({
      now,
      timezone,
      countryCode: settings.countryCode,
      lookaheadDays: CALENDAR_LOOKAHEAD_DAYS,
    });
    if (events.length === 0) {
      return [];
    }

    const categories = await this.categoryService.listForStore(store.id);

    return events.map((event) => {
      const matched = matchCategoriesToEvent(categories, event.tags);

      return {
        kind: AdvisorInsightKind.SeasonalEvent,
        severity: AdvisorSeverity.Info,
        // The year is part of the key: next Ramadan is not this Ramadan, and
        // dismissing one must not silence the other a year later.
        dedupeKey: `seasonal_event:${event.key}:${event.startsOn.slice(0, 4)}`,
        impactAmount: 0,
        // Sooner is more urgent, and a lookahead of 28 days keeps it small.
        rankWithin: CALENDAR_LOOKAHEAD_DAYS - event.daysUntil,
        payload: {
          eventKey: event.key,
          eventName: event.name,
          startsOn: event.startsOn,
          daysUntil: event.daysUntil,
          matchedCategoryIds: matched.map((category) => category.id),
          matchedCategoryNames: matched.map((category) => category.name),
        },
      };
    });
  }
}
