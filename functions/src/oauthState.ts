/** Signed OAuth `state` (carries brandId): HMAC-SHA256 + iat over base64(JSON), keyed off a
 * separate CONNECTOR_TOKEN_KEY subkey; fail-closed if key absent. Blocks forgery + STATE_MAX_AGE_MS replay. */
import { createHmac, timingSafeEqual, scryptSync } from 'crypto';
import { logger } from './utils/logger';
import { ALERT } from './utils/alertKeys';

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
    // Fail CLOSED — refuse to issue an unsigned (forgeable) OAuth state rather than
    // downgrading CSRF protection; CONNECTOR_TOKEN_KEY is provisioned in every deployed env.
    logger.error(`[oauthState] ${KEY_ENV} not configured — cannot sign OAuth state`, { alertKey: ALERT.oauthStateFailed });
    throw new Error('OAuth state signing key (CONNECTOR_TOKEN_KEY) is not configured');
  }
  return `${body}.${sign(body, key)}`;
}

/** Verify + decode an OAuth state. Returns the payload, or null if forged/expired/malformed. */
export function verifyState<T = Record<string, unknown>>(state: string | undefined | null): T | null {
  if (!state) return null;
  const key = loadKey();
  if (!key) {
    // Without the key we can't verify the signature — reject rather than accept a forged state.
    logger.error(`[oauthState] ${KEY_ENV} not configured — rejecting OAuth state`);
    return null;
  }
  const dot = state.lastIndexOf('.');
  const hasSig = dot > 0;
  const body = hasSig ? state.slice(0, dot) : state;
  const sig = hasSig ? state.slice(dot + 1) : '';

  if (!hasSig) {
    logger.warnAlert('[oauthState] rejecting unsigned OAuth state', { alertKey: ALERT.oauthStateFailed });
    return null;
  }
  const expected = Buffer.from(sign(body, key));
  const got = Buffer.from(sig);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    logger.warnAlert('[oauthState] OAuth state signature mismatch — possible forgery', { alertKey: ALERT.oauthStateFailed });
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
