import {
  decryptSecret,
  encryptSecret,
  isUsableCipherKey,
  matchesSecret,
} from './secret-cipher.util';

/** A 32-byte key, written out rather than generated, so a failure is repeatable. */
const KEY_HEX =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const OTHER_KEY_HEX =
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

describe('isUsableCipherKey', () => {
  it('accepts 64 hex characters', () => {
    expect(isUsableCipherKey(KEY_HEX)).toBe(true);
  });

  it('accepts a key with surrounding whitespace, as a .env line produces', () => {
    expect(isUsableCipherKey(`  ${KEY_HEX}\n`)).toBe(true);
  });

  it('rejects an empty key, which is how the feature is switched off', () => {
    expect(isUsableCipherKey('')).toBe(false);
  });

  it('rejects a key of the wrong length', () => {
    expect(isUsableCipherKey('abcdef')).toBe(false);
  });

  it('rejects a key that is not hex', () => {
    expect(isUsableCipherKey('z'.repeat(64))).toBe(false);
  });
});

describe('encryptSecret / decryptSecret', () => {
  const inputToken = '1//0gLpX-refresh-token-from-google';

  it('round-trips a refresh token', () => {
    const ciphertext = encryptSecret({
      plaintext: inputToken,
      keyHex: KEY_HEX,
    });

    expect(decryptSecret({ ciphertext, keyHex: KEY_HEX })).toBe(inputToken);
  });

  it('never stores the token in the clear', () => {
    const ciphertext = encryptSecret({
      plaintext: inputToken,
      keyHex: KEY_HEX,
    });

    expect(ciphertext).not.toContain(inputToken);
    expect(ciphertext).not.toContain('refresh-token');
  });

  it('produces a different ciphertext each time, because the IV is random', () => {
    const first = encryptSecret({ plaintext: inputToken, keyHex: KEY_HEX });
    const second = encryptSecret({ plaintext: inputToken, keyHex: KEY_HEX });

    expect(first).not.toEqual(second);
    expect(decryptSecret({ ciphertext: first, keyHex: KEY_HEX })).toBe(
      decryptSecret({ ciphertext: second, keyHex: KEY_HEX }),
    );
  });

  it('carries a version tag, so the algorithm can be changed later', () => {
    const ciphertext = encryptSecret({
      plaintext: inputToken,
      keyHex: KEY_HEX,
    });

    expect(ciphertext.startsWith('v1.')).toBe(true);
  });

  it('round-trips a token with non-ASCII characters', () => {
    const ciphertext = encryptSecret({
      plaintext: 'مفتاح-التحديث',
      keyHex: KEY_HEX,
    });

    expect(decryptSecret({ ciphertext, keyHex: KEY_HEX })).toBe(
      'مفتاح-التحديث',
    );
  });

  it('refuses to decrypt under a rotated key — which is what marks a connection expired', () => {
    const ciphertext = encryptSecret({
      plaintext: inputToken,
      keyHex: KEY_HEX,
    });

    expect(() =>
      decryptSecret({ ciphertext, keyHex: OTHER_KEY_HEX }),
    ).toThrow();
  });

  it('refuses a tampered ciphertext rather than decrypting it to something else', () => {
    const ciphertext = encryptSecret({
      plaintext: inputToken,
      keyHex: KEY_HEX,
    });
    const [version, iv, tag, data] = ciphertext.split('.');
    const flipped = `${data.startsWith('A') ? 'B' : 'A'}${data.slice(1)}`;

    expect(() =>
      decryptSecret({
        ciphertext: [version, iv, tag, flipped].join('.'),
        keyHex: KEY_HEX,
      }),
    ).toThrow();
  });

  it('refuses a ciphertext with a missing field', () => {
    expect(() =>
      decryptSecret({ ciphertext: 'v1.abc.def', keyHex: KEY_HEX }),
    ).toThrow('not in the expected format');
  });

  it('refuses an unknown format version', () => {
    const ciphertext = encryptSecret({
      plaintext: inputToken,
      keyHex: KEY_HEX,
    });
    const rest = ciphertext.split('.').slice(1).join('.');

    expect(() =>
      decryptSecret({ ciphertext: `v9.${rest}`, keyHex: KEY_HEX }),
    ).toThrow('Unsupported stored-secret version v9');
  });

  it('refuses to encrypt with an unusable key rather than storing something weak', () => {
    expect(() => encryptSecret({ plaintext: inputToken, keyHex: '' })).toThrow(
      'must be 64 hex characters',
    );
  });
});

describe('matchesSecret', () => {
  it('accepts an identical state value', () => {
    expect(matchesSecret('abc123', 'abc123')).toBe(true);
  });

  it('rejects a different value of the same length', () => {
    expect(matchesSecret('abc123', 'abc124')).toBe(false);
  });

  it('rejects a value of a different length without throwing', () => {
    expect(matchesSecret('abc123', 'abc')).toBe(false);
  });

  it('rejects an empty candidate', () => {
    expect(matchesSecret('abc123', '')).toBe(false);
  });
});
