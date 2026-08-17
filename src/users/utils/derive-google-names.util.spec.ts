import { GOOGLE_NAME_FALLBACK } from '../users.constants';
import { deriveGoogleNames } from './derive-google-names.util';

describe('deriveGoogleNames', () => {
  it('takes both claims when Google sends them', () => {
    const actual = deriveGoogleNames({
      firstName: 'Omar',
      lastName: 'Sanad',
      email: 'omar@example.com',
    });

    expect(actual).toEqual({ firstName: 'Omar', lastName: 'Sanad' });
  });

  it('accepts a single-name profile with an empty last name', () => {
    const actual = deriveGoogleNames({
      firstName: 'Cher',
      lastName: null,
      email: 'cher@example.com',
    });

    expect(actual).toEqual({ firstName: 'Cher', lastName: '' });
  });

  it('falls back to the local part when there is no given name', () => {
    const actual = deriveGoogleNames({
      firstName: null,
      lastName: 'Sanad',
      email: 'omar.sanad@example.com',
    });

    expect(actual).toEqual({ firstName: 'omar.sanad', lastName: 'Sanad' });
  });

  it('trims the claims rather than storing padded names', () => {
    const actual = deriveGoogleNames({
      firstName: '  Omar  ',
      lastName: '  Sanad ',
      email: 'omar@example.com',
    });

    expect(actual).toEqual({ firstName: 'Omar', lastName: 'Sanad' });
  });

  it('treats a whitespace-only claim as absent', () => {
    const actual = deriveGoogleNames({
      firstName: '   ',
      lastName: null,
      email: 'shopper@example.com',
    });

    expect(actual).toEqual({ firstName: 'shopper', lastName: '' });
  });

  it('keeps a non-Latin name as it is', () => {
    const actual = deriveGoogleNames({
      firstName: 'عمر',
      lastName: 'سند',
      email: 'omar@example.com',
    });

    expect(actual).toEqual({ firstName: 'عمر', lastName: 'سند' });
  });

  it('reaches the constant only when nothing else names the account', () => {
    const actual = deriveGoogleNames({
      firstName: null,
      lastName: null,
      email: '@example.com',
    });

    expect(actual).toEqual({
      firstName: GOOGLE_NAME_FALLBACK,
      lastName: '',
    });
  });

  it('never returns an empty first name', () => {
    const inputs = [
      { firstName: null, lastName: null, email: 'a@b.com' },
      { firstName: '', lastName: '', email: '@b.com' },
      { firstName: null, lastName: 'Only', email: '@b.com' },
    ];

    for (const input of inputs) {
      expect(deriveGoogleNames(input).firstName).not.toBe('');
    }
  });
});
