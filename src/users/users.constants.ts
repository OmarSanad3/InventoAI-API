export const BCRYPT_SALT_ROUNDS = 10;
export const OTP_LENGTH = 6;

/** Brand shown to platform (OWNER) accounts, which belong to no store. */
export const PLATFORM_BRAND_NAME = 'InventoAI';
/** Store segment of an OTP Redis key for a platform account. */
export const PLATFORM_OTP_SCOPE = 'platform';
/** Value stored under a resend-cooldown key; only its existence matters. */
export const OTP_COOLDOWN_MARKER = '1';

/**
 * Refused when Google will not vouch for the address. That claim is the entire
 * basis for trusting it, so without it there is nothing to link or create on.
 */
export const GOOGLE_EMAIL_UNVERIFIED_MESSAGE =
  "Your Google account's email is not verified";

/**
 * Told to an authenticated caller with no password hash — a Google-created
 * account that has never set one. The way to get one is the reset-password OTP,
 * which proves the mailbox exactly as it does for anybody else.
 */
export const NO_PASSWORD_SET_MESSAGE =
  'This account signs in with Google. Use the forgot-password flow to set a password first.';

/** Last resort for a Google profile carrying no name and no usable address. */
export const GOOGLE_NAME_FALLBACK = 'Google';

/**
 * Generous for an ID token (~1KB in practice) and small enough that the body is
 * rejected before any verification work is done on it.
 */
export const GOOGLE_ID_TOKEN_MAX_LENGTH = 4096;

/** Postgres' `unique_violation` SQLSTATE. */
export const UNIQUE_VIOLATION_CODE = '23505';
