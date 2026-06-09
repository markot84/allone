/**
 * Signed OAuth `state` (PP-12).
 *
 * The OAuth `state` carries the brandId that the resulting connector tokens get
 * written to. It used to be plain base64(JSON), so an attacker could forge a
 * state with a victim's brandId and have tokens written into the victim's brand.
 *
 * signState() now appends an HMAC-SHA256 signature and an issued-at timestamp;
 * verifyState() rejects any state whose signature doesn't match (forgery) or that
 * is older than STATE_MAX_AGE_MS (bounds replay of a leaked state). The key is
 * derived from CONNECTOR_TOKEN_KEY (already present on connectorAuth + callback),
 * with a separate subkey so it isn't the same bytes as token encryption.
 *
 * Fail-closed (SEC-L1): if the key is absent at runtime, signState throws and
 * verifyState rejects — we refuse to issue or accept an unsigned (forgeable) state
 * rather than silently downgrading CSRF protection. CONNECTOR_TOKEN_KEY is provisioned
 * in every deployed environment (same requirement as tokenCrypto / PP-13).
 */
import { createHmac, timingSafeEqual, scryptSync } from 'crypto';
import { logger } from 'firebase-functions/v2';

const KEY_ENV = 'CONNECTOR_TOKEN_KEY';
const STATE_MAX_AGE_MS = 30 * 60 * 1000; // 30 min OAuth-flow window

let cachedKey: Buffer | null | undefined;

function loadKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env[KEY_ENV]?.trim() || '';
  if (!raw) {
    cachedKey = null;
    return null;
  }
  const base = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : scryptSync(raw, 'pp.connector.token.salt.v1', 32);
  // Separate subkey for state signing (key separation from AES token encryption).
  cachedKey = createHmac('sha256', base).update('oauth-state-v1').digest();
  return cachedKey;
}

function sign(body: string, key: Buffer): string {
  return createHmac('sha256', key).update(body).digest('base64url');
}

/** Encode + sign an OAuth state payload. Returns `{body}.{sig}` (or just `{body}` if no key). */
export function signState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const key = loadKey();
  if (!key) {
    // SEC-L1: fail CLOSED — refuse to issue an unsigned (forgeable) OAuth state rather than
    // silently downgrading CSRF protection. Consistent with tokenCrypto (PP-13), which also
    // requires CONNECTOR_TOKEN_KEY; the secret is provisioned in every deployed environment.
    logger.error(`[oauthState] ${KEY_ENV} not configured — cannot sign OAuth state`);
    throw new Error('OAuth state signing key (CONNECTOR_TOKEN_KEY) is not configured');
  }
  return `${body}.${sign(body, key)}`;
}

/** Verify + decode an OAuth state. Returns the payload, or null if forged/expired/malformed. */
export function verifyState<T = Record<string, unknown>>(state: string | undefined | null): T | null {
  if (!state) return null;
  const key = loadKey();
  if (!key) {
    // SEC-L1: without the key we can't verify the signature — reject rather than accept a
    // potentially forged state. (Matches the fail-closed signState above.)
    logger.error(`[oauthState] ${KEY_ENV} not configured — rejecting OAuth state`);
    return null;
  }
  const dot = state.lastIndexOf('.');
  const hasSig = dot > 0;
  const body = hasSig ? state.slice(0, dot) : state;
  const sig = hasSig ? state.slice(dot + 1) : '';

  if (!hasSig) {
    logger.warn('[oauthState] rejecting unsigned OAuth state');
    return null;
  }
  const expected = Buffer.from(sign(body, key));
  const got = Buffer.from(sig);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    logger.warn('[oauthState] OAuth state signature mismatch — possible forgery');
    return null;
  }

  let parsed: Record<string, unknown> & { iat?: number };
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
  if (typeof parsed.iat === 'number' && Date.now() - parsed.iat > STATE_MAX_AGE_MS) {
    logger.warn('[oauthState] OAuth state expired');
    return null;
  }
  return parsed as T;
}
