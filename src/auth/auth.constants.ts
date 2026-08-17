/**
 * The only issuers a Google ID token may carry. `google-auth-library` checks
 * this itself; asserting it again costs nothing and keeps the rule visible.
 */
export const GOOGLE_ISSUERS: readonly string[] = [
  'accounts.google.com',
  'https://accounts.google.com',
];

/**
 * One message for every unusable token — malformed, expired, unsigned, or
 * minted for another app. Naming which would tell an attacker what to fix.
 */
export const GOOGLE_SIGN_IN_FAILED_MESSAGE = 'Google sign-in failed';

/** Worded like `AI_UNAVAILABLE_MESSAGE`: ours to fix, theirs to retry. */
export const GOOGLE_UNAVAILABLE_MESSAGE =
  'Google sign-in is temporarily unavailable, please try again later';

/** Node socket failures, which mean "Google unreachable" rather than "bad token". */
export const TRANSPORT_ERROR_CODES: readonly string[] = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
];
