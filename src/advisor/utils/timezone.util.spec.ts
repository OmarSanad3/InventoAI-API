import {
  daysBetween,
  getLocalDateString,
  getLocalHour,
  isValidTimezone,
  subtractDays,
} from './timezone.util';

describe('getLocalDateString', () => {
  it("gives the store's day, not the server's", () => {
    // 22:30 UTC is already tomorrow in Cairo (UTC+2/+3).
    const inputInstant = new Date('2026-08-16T22:30:00Z');

    expect(getLocalDateString(inputInstant, 'Africa/Cairo')).toBe('2026-08-17');
    expect(getLocalDateString(inputInstant, 'UTC')).toBe('2026-08-16');
  });

  it('pads a single-digit month and day', () => {
    const inputInstant = new Date('2026-01-05T12:00:00Z');

    expect(getLocalDateString(inputInstant, 'UTC')).toBe('2026-01-05');
  });
});

describe('getLocalHour', () => {
  it('reads the wall clock of the zone it was given', () => {
    const inputInstant = new Date('2026-08-16T05:00:00Z');

    expect(getLocalHour(inputInstant, 'Africa/Cairo')).toBe(8);
    expect(getLocalHour(inputInstant, 'UTC')).toBe(5);
  });

  /**
   * The reason `hourCycle: 'h23'` is set: the default gives `24` for midnight
   * in some locales, and a store with `sendHour: 0` would then never be due.
   */
  it('reports midnight as 0, never as 24', () => {
    // 21:00Z, because Egypt is UTC+3 in August — which is the other reason
    // this goes through `Intl` rather than through an offset someone typed.
    const inputInstant = new Date('2026-08-16T21:00:00Z');

    expect(getLocalHour(inputInstant, 'Africa/Cairo')).toBe(0);
  });

  it('follows the zone across a daylight-saving change', () => {
    const inputSummer = new Date('2026-08-16T09:00:00Z');
    const inputWinter = new Date('2026-12-16T09:00:00Z');

    expect(getLocalHour(inputSummer, 'Africa/Cairo')).toBe(12);
    expect(getLocalHour(inputWinter, 'Africa/Cairo')).toBe(11);
  });
});

describe('isValidTimezone', () => {
  it('accepts an IANA zone', () => {
    expect(isValidTimezone('Africa/Cairo')).toBe(true);
  });

  it('rejects anything Intl will not take, rather than throwing', () => {
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});

describe('subtractDays and daysBetween', () => {
  it('walks back a whole number of days', () => {
    const actual = subtractDays(new Date('2026-08-16T12:00:00Z'), 7);

    expect(actual.toISOString()).toBe('2026-08-09T12:00:00.000Z');
  });

  it('counts whole elapsed days', () => {
    const actual = daysBetween(
      new Date('2026-08-01T12:00:00Z'),
      new Date('2026-08-16T11:00:00Z'),
    );

    expect(actual).toBe(14);
  });

  it('never returns a negative age for a future date', () => {
    const actual = daysBetween(
      new Date('2026-08-16T12:00:00Z'),
      new Date('2026-08-01T12:00:00Z'),
    );

    expect(actual).toBe(0);
  });
});
