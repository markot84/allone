/** Tests for functions/src/tokenCrypto.ts (AES-256-GCM): round-trip, isEncrypted, legacy
 * pass-through + idempotent encrypt, fail-closed encrypt when CONNECTOR_TOKEN_KEY is missing. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptToken, encryptToken, isEncrypted } from '../../tokenCrypto';

const PREFIX = 'enc:v1:';

describe('tokenCrypto', () => {
  describe('encryptToken -> decryptToken round-trip (key present)', () => {
    it('encryptToken returns an enc:v1: string and decryptToken recovers the original plaintext', () => {
      // Arrange
      // Representative connector token (not a real credential; no provider prefix to avoid scanners).
      const plain = 'connector-token-sample-value';

      // Act
      const encrypted = encryptToken(plain);
      const decrypted = decryptToken(encrypted);

      // Assert
      expect(encrypted.startsWith(PREFIX)).toBe(true);
      expect(encrypted).not.toBe(plain);
      expect(decrypted).toBe(plain);
    });

    it('produces a fresh nonce per call, so the same plaintext encrypts to different ciphertexts', () => {
      // Arrange
      const plain = 'identical-secret';

      // Act
      const a = encryptToken(plain);
      const b = encryptToken(plain);

      // Assert — different ciphertexts, but both decrypt back to the same value
      expect(a).not.toBe(b);
      expect(decryptToken(a)).toBe(plain);
      expect(decryptToken(b)).toBe(plain);
    });

    it('encrypts an empty string as an empty string (no-op for falsy input)', () => {
      // Arrange / Act / Assert
      expect(encryptToken('')).toBe('');
      expect(encryptToken(null)).toBe('');
      expect(encryptToken(undefined)).toBe('');
    });
  });

  describe('isEncrypted', () => {
    it('returns true for an enc:v1: value', () => {
      // Arrange
      const encrypted = encryptToken('whatever');

      // Act / Assert
      expect(isEncrypted(encrypted)).toBe(true);
      expect(isEncrypted(`${PREFIX}nonce:payload`)).toBe(true);
    });

    it('returns false for plaintext and non-string values', () => {
      // Act / Assert
      expect(isEncrypted('plain-legacy-token')).toBe(false);
      expect(isEncrypted('')).toBe(false);
      expect(isEncrypted(null)).toBe(false);
      expect(isEncrypted(undefined)).toBe(false);
      expect(isEncrypted(42)).toBe(false);
    });
  });

  describe('legacy plaintext pass-through & idempotency', () => {
    it('decryptToken returns a legacy plaintext token unchanged', () => {
      // Arrange
      const legacy = 'plain-legacy-token';

      // Act / Assert
      expect(decryptToken(legacy)).toBe(legacy);
    });

    it('decryptToken returns "" for falsy input', () => {
      // Act / Assert
      expect(decryptToken('')).toBe('');
      expect(decryptToken(null)).toBe('');
      expect(decryptToken(undefined)).toBe('');
    });

    it('encryptToken is idempotent: re-encrypting an already-encrypted value returns it unchanged', () => {
      // Arrange
      const encrypted = encryptToken('secret-token');

      // Act
      const again = encryptToken(encrypted);

      // Assert — the already-encrypted value is returned as-is (not double-wrapped)
      expect(again).toBe(encrypted);
      expect(decryptToken(again)).toBe('secret-token');
    });
  });

  describe('fail-CLOSED when CONNECTOR_TOKEN_KEY is missing', () => {
    const ORIGINAL_KEY = process.env.CONNECTOR_TOKEN_KEY;

    beforeEach(() => {
      // Module caches the key on first use; reset registry so a fresh import re-reads the mutated env.
      vi.resetModules();
    });

    afterEach(() => {
      // Restore the test key and module registry for any later suites.
      if (ORIGINAL_KEY === undefined) {
        delete process.env.CONNECTOR_TOKEN_KEY;
      } else {
        process.env.CONNECTOR_TOKEN_KEY = ORIGINAL_KEY;
      }
      vi.resetModules();
    });

    it('encryptToken THROWS instead of silently returning plaintext', async () => {
      // Arrange — remove the key BEFORE the (fresh) module loads it.
      delete process.env.CONNECTOR_TOKEN_KEY;
      const { encryptToken: encryptNoKey } = await import('../../tokenCrypto');

      // Act / Assert — must throw, NOT return the plaintext (no silent downgrade).
      expect(() => encryptNoKey('secret-token')).toThrow(
        /CONNECTOR_TOKEN_KEY/,
      );
    });

    it('still short-circuits falsy/already-encrypted input without needing the key', async () => {
      // Arrange
      delete process.env.CONNECTOR_TOKEN_KEY;
      const { encryptToken: encryptNoKey } = await import('../../tokenCrypto');

      // Act / Assert — falsy returns '' and already-encrypted passes through, before the key check.
      expect(encryptNoKey('')).toBe('');
      expect(encryptNoKey(`${PREFIX}nonce:payload`)).toBe(`${PREFIX}nonce:payload`);
    });

    it('decryptToken does NOT throw without the key — it returns "" for encrypted input and passes plaintext through', async () => {
      // Arrange
      delete process.env.CONNECTOR_TOKEN_KEY;
      const { decryptToken: decryptNoKey } = await import('../../tokenCrypto');

      // Act / Assert — decrypt is intentionally fail-soft (controlled empty), unlike fail-closed encrypt.
      expect(decryptNoKey(`${PREFIX}nonce:payload`)).toBe('');
      expect(decryptNoKey('plain-legacy-token')).toBe('plain-legacy-token');
    });
  });
});
