/**
 * The calendar the Advisor watches, and it needs no API and no key.
 *
 * Two kinds of event. The Hijri ones — Ramadan and the two Eids — are computed
 * from Node's own ICU (`en-u-ca-islamic-umalqura`), which is why this feature
 * ships no date library and no third-party calendar. The rest are a table.
 *
 * **On Umm al-Qura:** it is a *calculated* calendar, and the announced start of
 * Ramadan can differ from it by a day depending on the sighting. That is fine
 * here and must stay fine: the brief says "in about three weeks", never a
 * countdown to a specific hour. Do not "fix" this into precision it does not
 * have.
 */

/** Which of the store's categories an event is likely to be about. */
export type CalendarTag = string;

interface BaseEvent {
  /** Stable across years; the dedupe key appends the year. */
  key: string;
  name: string;
  /**
   * Lowercase substrings matched against the store's own category names, in
   * English and Arabic. A match is a hint for the sentence, never a filter:
   * an event with no matching category is still worth knowing about.
   */
  tags: readonly CalendarTag[];
}

/** A fixed Gregorian date — 1 January, 25 April. */
export interface FixedDateEvent extends BaseEvent {
  type: 'fixed';
  month: number;
  day: number;
}

/** The nth weekday of a month — Black Friday is the fourth Friday of November. */
export interface NthWeekdayEvent extends BaseEvent {
  type: 'nth-weekday';
  month: number;
  /** 0 = Sunday, as `Date.getUTCDay()` counts. */
  weekday: number;
  nth: number;
}

/** A Hijri date, resolved through ICU rather than stored. */
export interface HijriEvent extends BaseEvent {
  type: 'hijri';
  /** 1–12, where 9 is Ramadan and 12 is Dhu al-Hijjah. */
  hijriMonth: number;
  hijriDay: number;
}

export type CalendarEventDefinition =
  FixedDateEvent | NthWeekdayEvent | HijriEvent;

/**
 * Observed everywhere the platform is sold, so they are not gated on a country
 * code. A store that does not care dismisses the line and it stays gone for a
 * week.
 */
export const HIJRI_EVENTS: readonly HijriEvent[] = [
  {
    type: 'hijri',
    key: 'ramadan',
    name: 'Ramadan',
    hijriMonth: 9,
    hijriDay: 1,
    tags: [
      'ramadan',
      'رمضان',
      'dates',
      'تمر',
      'lantern',
      'fanoos',
      'فانوس',
      'sweet',
      'حلوى',
      'decor',
      'زينة',
      'gift',
      'هدايا',
      'kitchen',
      'مطبخ',
    ],
  },
  {
    type: 'hijri',
    key: 'eid-al-fitr',
    name: 'Eid al-Fitr',
    hijriMonth: 10,
    hijriDay: 1,
    tags: [
      'eid',
      'عيد',
      'gift',
      'هدايا',
      'clothes',
      'ملابس',
      'abaya',
      'عباية',
      'kids',
      'أطفال',
      'sweet',
      'حلوى',
      'toy',
      'ألعاب',
    ],
  },
  {
    type: 'hijri',
    key: 'eid-al-adha',
    name: 'Eid al-Adha',
    hijriMonth: 12,
    hijriDay: 10,
    tags: [
      'eid',
      'عيد',
      'gift',
      'هدايا',
      'clothes',
      'ملابس',
      'kitchen',
      'مطبخ',
      'home',
      'منزل',
    ],
  },
];

/** Everywhere, regardless of the store's country. */
export const GLOBAL_EVENTS: readonly CalendarEventDefinition[] = [
  {
    type: 'fixed',
    key: 'new-year',
    name: 'New Year',
    month: 1,
    day: 1,
    tags: ['gift', 'هدايا', 'decor', 'زينة', 'party', 'home', 'منزل'],
  },
  {
    type: 'nth-weekday',
    key: 'black-friday',
    name: 'Black Friday',
    month: 11,
    weekday: 5,
    nth: 4,
    tags: ['sale', 'خصم', 'gift', 'هدايا', 'electronics', 'إلكترونيات'],
  },
];

/**
 * Per country, and deliberately short. A wrong local holiday is worse than a
 * missing one — it is the line that makes an owner stop believing the rest.
 */
export const COUNTRY_EVENTS: Readonly<
  Record<string, readonly CalendarEventDefinition[]>
> = {
  EG: [
    {
      type: 'fixed',
      key: 'mothers-day-eg',
      name: "Mother's Day",
      month: 3,
      day: 21,
      tags: [
        'gift',
        'هدايا',
        'flower',
        'ورد',
        'perfume',
        'عطر',
        'jewel',
        'ذهب',
      ],
    },
    {
      type: 'fixed',
      key: 'back-to-school-eg',
      name: 'Back to school',
      month: 9,
      day: 20,
      tags: [
        'school',
        'مدرسة',
        'bag',
        'حقيبة',
        'stationery',
        'قرطاسية',
        'kids',
        'أطفال',
        'book',
        'كتب',
      ],
    },
  ],
};
