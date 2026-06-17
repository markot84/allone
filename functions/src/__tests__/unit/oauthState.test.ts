/** Signed OAuth `state`: signState() appends an HMAC-SHA256 signature + `iat`; verifyState() rejects forged
 * signatures or states older than STATE_MAX_AGE_MS (30 min). setup.ts provides a 64-hex CONNECTOR_TOKEN_KEY. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from 'firebase-functions/v2';
import { signState, verifyState } from '../../oauthState';

// STATE_MAX_AGE_MS in the module under test (30 min OAuth-flow window).
const STATE_MAX_AGE_MS = 30 * 60 * 1000;

beforeEach(() => {
  // Keep test output clean: the module logs warnings on every rejection path.
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('oauthState', () => {
  describe('signState -> verifyState round-trip', () => {
    it('verifies an honestly-signed payload back to its original fields', () => {
      // Arrange
      const payload = { brandId: 'brand-abc', connector: 'shopify', nonce: '42' };

      // Act
      const state = signState(payload);
      const verified = verifyState(state);

      // Assert: every original field survives the round-trip.
      expect(verified).not.toBeNull();
      expect(verified).toMatchObject(payload);
    });

    it('produces a signed `{body}.{sig}` shape when the key is present', () => {
      // Arrange + Act
      const state = signState({ brandId: 'brand-xyz' });

      // Assert: a signature segment is appended (not bare base64 body).
      const dot = state.lastIndexOf('.');
      expect(dot).toBeGreaterThan(0);
      expect(state.slice(dot + 1).length).toBeGreaterThan(0);
    });

    it('attaches an `iat` timestamp not present in the original payload', () => {
      // Arrange
      const payload = { brandId: 'brand-iat' };

      // Act
      const verified = verifyState<Record<string, unknown>>(signState(payload));

      // Assert
      expect(verified).not.toBeNull();
      expect(typeof verified?.iat).toBe('number');
    });
  });

  describe('tampered signature / body', () => {
    it('returns null when the signature is mutated', () => {
      // Arrange
      const state = signState({ brandId: 'brand-sig' });
      const dot = state.lastIndexOf('.');
      const body = state.slice(0, dot);
      const sig = state.slice(dot + 1);
      // Flip the first signature char to a different base64url char.
      const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
      const tampered = `${body}.${flipped}`;

      // Act + Assert
      expect(verifyState(tampered)).toBeNull();
    });

    it('returns null when the signed body is mutated (signature no longer matches)', () => {
      // Arrange: re-encode the payload with a different brandId while keeping the old sig.
      const state = signState({ brandId: 'victim-brand' });
      const dot = state.lastIndexOf('.');
      const sig = state.slice(dot + 1);
      const forgedBody = Buffer.from(
        JSON.stringify({ brandId: 'attacker-brand', iat: Date.now() }),
      ).toString('base64url');
      const forged = `${forgedBody}.${sig}`;

      // Act + Assert: signature was computed over the original body, so this fails.
      expect(verifyState(forged)).toBeNull();
    });
  });

  describe('expiry (STATE_MAX_AGE_MS)', () => {
    it('returns null for a state older than the allowed TTL', () => {
      // Arrange: sign at a fixed instant, then advance the clock past the window.
      vi.useFakeTimers();
      const issuedAt = new Date('2026-06-04T00:00:00.000Z');
      vi.setSystemTime(issuedAt);
      const state = signState({ brandId: 'brand-stale' });

      // Act: jump 1ms past the 30-minute window.
      vi.setSystemTime(issuedAt.getTime() + STATE_MAX_AGE_MS + 1);

      // Assert
      expect(verifyState(state)).toBeNull();
    });

    it('still accepts a state within the allowed TTL', () => {
      // Arrange
      vi.useFakeTimers();
      const issuedAt = new Date('2026-06-04T00:00:00.000Z');
      vi.setSystemTime(issuedAt);
      const state = signState({ brandId: 'brand-fresh' });

      // Act: advance to just before expiry (still inside the window).
      vi.setSystemTime(issuedAt.getTime() + STATE_MAX_AGE_MS - 1);
      const verified = verifyState(state);

      // Assert: signature is valid AND not yet expired.
      expect(verified).toMatchObject({ brandId: 'brand-fresh' });
    });
  });

  describe('garbage / unsigned input', () => {
    it('returns null for a non-state string', () => {
      // Act + Assert
      expect(verifyState('not-a-real-state')).toBeNull();
    });

    it('returns null for undefined', () => {
      // Act + Assert
      expect(verifyState(undefined)).toBeNull();
    });

    it('returns null for null', () => {
      // Act + Assert
      expect(verifyState(null)).toBeNull();
    });

    it('returns null for an empty string', () => {
      // Act + Assert
      expect(verifyState('')).toBeNull();
    });

    it('returns null for an unsigned bare body when the key is configured', () => {
      // Arrange: a valid base64url JSON body but with NO signature segment.
      // With the key present, verifyState must reject unsigned state.
      const bareBody = Buffer.from(
        JSON.stringify({ brandId: 'brand-unsigned', iat: Date.now() }),
      ).toString('base64url');

      // Act + Assert
      expect(verifyState(bareBody)).toBeNull();
    });
  });

  describe('fail-closed when CONNECTOR_TOKEN_KEY is absent', () => {
    it('signState throws and verifyState rejects without the key (no silent unsigned downgrade)', async () => {
      // The module caches the key on first use, so load a FRESH instance with the env var
      // removed to exercise the no-key path in isolation.
      const saved = process.env.CONNECTOR_TOKEN_KEY;
      delete process.env.CONNECTOR_TOKEN_KEY;
      vi.resetModules();
      vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      try {
        const mod = await import('../../oauthState');
        // No key → refuse to ISSUE an unsigned (forgeable) state.
        expect(() => mod.signState({ brandId: 'brand-nokey' })).toThrow();
        // No key → can't verify a signature, so REJECT rather than accept unsigned/forged state.
        const bareBody = Buffer.from(JSON.stringify({ brandId: 'x', iat: Date.now() })).toString('base64url');
        expect(mod.verifyState(`${bareBody}.anysig`)).toBeNull();
        expect(mod.verifyState(bareBody)).toBeNull();
      } finally {
        if (saved !== undefined) process.env.CONNECTOR_TOKEN_KEY = saved;
        vi.resetModules();
      }
    });
  });
});
