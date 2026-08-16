import { findUpcomingEvents, matchCategoriesToEvent } from './calendar.util';

/**
 * The Hijri dates asserted here were checked against ICU before the helper was
 * written: 8 February 2027 is 1 Ramadan 1448, 9 March 2027 is Eid al-Fitr, and
 * 16 May 2027 is Eid al-Adha. They are the reason this feature needs no date
 * library — and the reason a regression here would be silent otherwise.
 */
describe('findUpcomingEvents', () => {
  const timezone = 'Africa/Cairo';

  it('finds Ramadan three weeks out, with the days until it', () => {
    const inputNow = new Date('2027-01-25T09:00:00Z');

    const actual = findUpcomingEvents({ now: inputNow, timezone });

    const ramadan = actual.find((event) => event.key === 'ramadan');
    expect(ramadan).toBeDefined();
    expect(ramadan?.startsOn).toBe('2027-02-08');
    expect(ramadan?.daysUntil).toBe(14);
  });

  it('finds nothing when the window holds nothing', () => {
    const inputNow = new Date('2027-06-10T09:00:00Z');

    const actual = findUpcomingEvents({
      now: inputNow,
      timezone,
      lookaheadDays: 10,
    });

    expect(actual).toEqual([]);
  });

  it('reports an event starting today as 0 days away', () => {
    const inputNow = new Date('2027-02-08T09:00:00Z');

    const actual = findUpcomingEvents({ now: inputNow, timezone });

    expect(actual[0]?.key).toBe('ramadan');
    expect(actual[0]?.daysUntil).toBe(0);
  });

  it('finds Eid al-Fitr, which is a different Hijri month entirely', () => {
    const inputNow = new Date('2027-03-01T09:00:00Z');

    const actual = findUpcomingEvents({ now: inputNow, timezone });

    const eid = actual.find((event) => event.key === 'eid-al-fitr');
    expect(eid?.startsOn).toBe('2027-03-09');
  });

  it('finds Eid al-Adha', () => {
    const inputNow = new Date('2027-05-05T09:00:00Z');

    const actual = findUpcomingEvents({ now: inputNow, timezone });

    const eid = actual.find((event) => event.key === 'eid-al-adha');
    expect(eid?.startsOn).toBe('2027-05-16');
  });

  it('yields the Hijri events and no local ones for an unknown country', () => {
    const inputNow = new Date('2027-09-05T09:00:00Z');

    const actual = findUpcomingEvents({
      now: inputNow,
      timezone,
      countryCode: 'ZZ',
    });

    expect(actual.some((event) => event.key === 'back-to-school-eg')).toBe(
      false,
    );
  });

  it("adds the store's country events when it has one", () => {
    const inputNow = new Date('2027-09-05T09:00:00Z');

    const actual = findUpcomingEvents({
      now: inputNow,
      timezone,
      countryCode: 'eg',
    });

    expect(actual.some((event) => event.key === 'back-to-school-eg')).toBe(
      true,
    );
  });

  it('resolves Black Friday as the fourth Friday of November', () => {
    const inputNow = new Date('2026-11-10T09:00:00Z');

    const actual = findUpcomingEvents({ now: inputNow, timezone });

    const blackFriday = actual.find((event) => event.key === 'black-friday');
    expect(blackFriday?.startsOn).toBe('2026-11-27');
  });

  it('returns the soonest event first', () => {
    const inputNow = new Date('2027-02-01T09:00:00Z');

    const actual = findUpcomingEvents({ now: inputNow, timezone });

    const distances = actual.map((event) => event.daysUntil);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('never reports the same event twice within one window', () => {
    const inputNow = new Date('2027-01-25T09:00:00Z');

    const actual = findUpcomingEvents({ now: inputNow, timezone });

    const keys = actual.map((event) => event.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('matchCategoriesToEvent', () => {
  it("matches a store's categories on the event's tags, in either language", () => {
    const inputCategories = [
      { id: '1', name: 'Ramadan Lanterns' },
      { id: '2', name: 'فوانيس رمضان' },
      { id: '3', name: 'Car Parts' },
    ];

    const actual = matchCategoriesToEvent(inputCategories, [
      'lantern',
      'رمضان',
    ]);

    expect(actual.map((category) => category.id)).toEqual(['1', '2']);
  });

  it('is case-insensitive', () => {
    const inputCategories = [{ id: '1', name: 'DATES & SWEETS' }];

    const actual = matchCategoriesToEvent(inputCategories, ['dates']);

    expect(actual).toHaveLength(1);
  });

  it('returns nothing rather than guessing when nothing matches', () => {
    const inputCategories = [{ id: '1', name: 'Car Parts' }];

    const actual = matchCategoriesToEvent(inputCategories, ['lantern']);

    expect(actual).toEqual([]);
  });
});
