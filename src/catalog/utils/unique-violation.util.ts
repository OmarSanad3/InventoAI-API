import { QueryFailedError } from 'typeorm';

const UNIQUE_VIOLATION = '23505';

/**
 * The name of the unique index a failed write collided with, or `null` when the
 * error was something else.
 *
 * The catalog has three of them on one transaction — slug, SKU and options —
 * and they mean entirely different things to the owner, so the caller has to be
 * able to tell which one fired.
 */
export function getUniqueViolation(err: unknown): string | null {
  if (!(err instanceof QueryFailedError)) {
    return null;
  }

  const driverError = err.driverError as {
    code?: string;
    constraint?: string;
  };
  if (driverError.code !== UNIQUE_VIOLATION) {
    return null;
  }
  return driverError.constraint ?? '';
}
