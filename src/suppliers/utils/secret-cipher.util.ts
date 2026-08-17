import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Symmetric encryption for the one secret this project stores that is a key to
 * somebody else's property: a Google refresh token for a human's mailbox.
 *
 * A refresh token is not a password hash — we have to be able to *use* it, so
 * it cannot be hashed, and that makes reversible encryption the only option.
 * What it buys is narrow and worth stating plainly: a leaked database dump is
 * not a leaked set of mailboxes, because the key lives in the environment and
 * not in Postgres. It buys nothing at all against an attacker who has both.
 *
 * AES-256-GCM rather than CBC because GCM authenticates: a tampered ciphertext
 * fails to decrypt instead of decrypting to something else. The IV is random
 * per encryption and stored alongside, which is what makes encrypting the same
 * token twice produce two different rows.
 */

/** `aes-256-*` means a 256-bit key, which is 32 bytes, which is 64 hex chars. */
const KEY_BYTES = 32;
const IV_BYTES = 12;
const ALGORITHM = 'aes-256-gcm';

/**
 * A version tag on every ciphertext, so rotating the algorithm later is a
 * branch on read rather than a table that cannot be decrypted.
 */
const FORMAT_VERSION = 'v1';

/** `.` is not in the base64 alphabet, so it can never appear inside a field. */
const FIELD_SEPARATOR = '.';

/**
 * Whether a configured key is usable, without throwing.
 *
 * The connect route asks this before it starts an OAuth flow: sending an owner
 * to Google, taking their consent and *then* discovering we cannot store the
 * grant would be a consent screen spent for nothing.
 */
export function isUsableCipherKey(keyHex: string): boolean {
  return readKey(keyHex) !== null;
}

/** `v1.<iv>.<authTag>.<ciphertext>`, each field base64. */
export function encryptSecret({
  plaintext,
  keyHex,
}: {
  plaintext: string;
  keyHex: string;
}): string {
  const key = requireKey(keyHex);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return [
    FORMAT_VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(FIELD_SEPARATOR);
}

/**
 * **Throws** on anything it cannot verify — a wrong key, a truncated field, a
 * flipped bit, an unknown version. The caller turns that into "this connection
 * needs reconnecting", which is the honest reading: a grant we cannot decrypt
 * is a grant we do not have.
 */
export function decryptSecret({
  ciphertext,
  keyHex,
}: {
  ciphertext: string;
  keyHex: string;
}): string {
  const key = requireKey(keyHex);

  const parts = ciphertext.split(FIELD_SEPARATOR);
  if (parts.length !== 4) {
    throw new Error('Stored secret is not in the expected format');
  }

  const [version, ivPart, tagPart, dataPart] = parts;
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported stored-secret version ${version}`);
  }

  const iv = Buffer.from(ivPart, 'base64');
  const authTag = Buffer.from(tagPart, 'base64');
  if (iv.length !== IV_BYTES) {
    throw new Error('Stored secret has a malformed IV');
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Constant-time comparison for the OAuth `state` parameter.
 *
 * `===` on a secret leaks its prefix through timing. The window is tiny and the
 * value is short-lived, but this is a CSRF guard on a route that attaches a
 * mailbox to a store, and the cheap version of the comparison is the right one.
 */
export function matchesSecret(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function requireKey(keyHex: string): Buffer {
  const key = readKey(keyHex);
  if (!key) {
    throw new Error(
      `Mailbox token encryption key must be ${KEY_BYTES * 2} hex characters`,
    );
  }
  return key;
}

function readKey(keyHex: string): Buffer | null {
  const trimmed = keyHex.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
    return null;
  }
  const key = Buffer.from(trimmed, 'hex');
  return key.length === KEY_BYTES ? key : null;
}
