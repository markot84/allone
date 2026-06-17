/** Connector token encryption-at-rest (AES-256-GCM), format `enc:v1:{nonce_b64url}:{ct+tag_b64url}`. Legacy plaintext passes through; new tokens encrypt on next refresh once CONNECTOR_TOKEN_KEY (32-byte hex secret) is set on every function reading tokens. */
import { randomBytes, createCipheriv, createDecipheriv, scryptSync, type CipherGCM, type DecipherGCM } from 'crypto';
import { logger } from './utils/logger';
import { ALERT } from './utils/alertKeys';

const PREFIX = 'enc:v1:';
const KEY_ENV = 'CONNECTOR_TOKEN_KEY';

let cachedKey: Buffer | null | undefined;

function loadKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env[KEY_ENV]?.trim() || '';
  if (!raw) {
    cachedKey = null;
    return null;
  }
  // 64-char hex (preferred): direct 32-byte key
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    cachedKey = Buffer.from(raw, 'hex');
    return cachedKey;
  }
  // Fallback: derive 32 bytes via scrypt with a fixed salt (idempotent across deploys)
  cachedKey = scryptSync(raw, 'pp.connector.token.salt.v1', 32);
  return cachedKey;
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** Encrypt plaintext (idempotent); fails closed (throws) on missing key rather than storing plaintext. */
export function encryptToken(plaintext: string | null | undefined): string {
  if (!plaintext) return '';
  if (isEncrypted(plaintext)) return plaintext;
  const key = loadKey();
  if (!key) {
    // Fail CLOSED: refuse to persist a token unencrypted rather than downgrade to plaintext.
    // Should never fire in a correct deployment (CONNECTOR_TOKEN_KEY declared everywhere); if it does, a secret is missing.
    logger.error(`[tokenCrypto] ${KEY_ENV} not configured — refusing to store connector token in plaintext`, { alertKey: ALERT.tokenCryptoFailed });
    throw new Error('Connector token encryption key (CONNECTOR_TOKEN_KEY) is not configured');
  }
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 }) as CipherGCM;
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([enc, tag]);
    return `${PREFIX}${nonce.toString('base64url')}:${payload.toString('base64url')}`;
  } catch (err) {
    // Fail CLOSED on cipher errors too: refuse to persist plaintext rather than downgrade.
    logger.error('[tokenCrypto] encrypt failed — refusing to store connector token in plaintext:', { alertKey: ALERT.tokenCryptoFailed, err });
    throw new Error('Connector token encryption failed');
  }
}

/** Decrypt encrypted string or pass through plaintext; returns '' on error (no throw). */
export function decryptToken(value: string | null | undefined): string {
  if (!value) return '';
  if (!isEncrypted(value)) return value;
  const key = loadKey();
  if (!key) {
    logger.error(`[tokenCrypto] cannot decrypt — ${KEY_ENV} missing. Token will appear empty.`, { alertKey: ALERT.tokenCryptoFailed });
    return '';
  }
  try {
    const body = value.slice(PREFIX.length);
    const idx = body.indexOf(':');
    if (idx < 1) return '';
    const nonceB64 = body.slice(0, idx);
    const payloadB64 = body.slice(idx + 1);
    const nonce = Buffer.from(nonceB64, 'base64url');
    const payload = Buffer.from(payloadB64, 'base64url');
    if (nonce.length !== 12 || payload.length < 17) return '';
    const tag = payload.slice(payload.length - 16);
    const ct = payload.slice(0, payload.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 }) as DecipherGCM;
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
    return dec.toString('utf8');
  } catch (err) {
    logger.error('[tokenCrypto] decrypt failed:', { alertKey: ALERT.tokenCryptoFailed, err });
    return '';
  }
}
