import { GOOGLE_NAME_FALLBACK } from '../users.constants';

export interface DeriveGoogleNamesInput {
  /** Google's `given_name`, absent on some profiles. */
  readonly firstName: string | null;
  /** Google's `family_name`, absent on a single-name profile. */
  readonly lastName: string | null;
  /** The verified address, the last thing left to name someone by. */
  readonly email: string;
}

export interface GoogleNames {
  readonly firstName: string;
  readonly lastName: string;
}

/**
 * `User.firstName` and `User.lastName` are both `NOT NULL`, and Google's name
 * claims are optional — a single-name profile carries no `family_name` at all.
 * So a name is derived rather than assumed: the claims first, then the local
 * part of the address, and a constant only if both are empty.
 *
 * An empty `lastName` is a real outcome, not a bug: it is what the account is
 * called. The owner can edit it afterwards like any other profile field.
 */
export function deriveGoogleNames({
  firstName,
  lastName,
  email,
}: DeriveGoogleNamesInput): GoogleNames {
  const given = firstName?.trim() ?? '';
  const family = lastName?.trim() ?? '';
  if (given) {
    return { firstName: given, lastName: family };
  }

  const localPart = email.split('@')[0]?.trim() ?? '';
  return {
    firstName: localPart || family || GOOGLE_NAME_FALLBACK,
    lastName: localPart ? family : '',
  };
}
