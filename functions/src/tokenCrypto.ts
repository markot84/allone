/**
 * Connector token encryption-at-rest (AES-256-GCM).
 *
 * Format: `enc:v1:{nonce_base64url}:{ciphertext+tag_base64url}`
 *
 * Στρατηγική για zero-downtime migration:
 *  - `decryptToken(value)`: αν αρχίζει με `enc:v1:` αποκρυπτογραφεί.
 *    Αλλιώς το επιστρέφει αυτούσιο (legacy plaintext tokens συνεχίζουν να δουλεύουν).
 *  - `encryptToken(plain)`: επιστρέφει encrypted string. Αν δεν υπάρχει
 *    `CONNECTOR_TOKEN_KEY` (Secret Manager), επιστρέφει το plaintext με warning.
 *  - Αυτή η transparency εξασφαλίζει ότι deploys χωρίς το secret δεν σπάνε
 *    υπάρχουσες συνδέσεις. Όταν προστεθεί το secret + redeploy, νέα tokens
 *    encrypt-άρονται αυτόματα στο επόμενο OAuth refresh / reconnect.
 *
 * Master key: 32 bytes (64 hex chars). Δημιουργία:
 *   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
 *
 * Setup:
 *   1) `firebase functions:secrets:set CONNECTOR_TOKEN_KEY` (paste hex)
 *   2) Πρόσθεσε `'CONNECTOR_TOKEN_KEY'` στο `secrets:` array κάθε function
 *      που διαβάζει connector tokens (connectorCallback, connectorSync,
 *      connectorSelectAccount, scheduledSync, refreshAggregates, κ.λπ.)
 *   3) Redeploy. Νέα tokens encrypt-άρονται αυτόματα.
 */
import { randomBytes, createCipheriv, createDecipheriv, scryptSync, type CipherGCM, type DecipherGCM } from 'crypto';
import { logger } from 'firebase-functions/v2';

const PREFIX = 'enc:v1:';
const KEY_ENV = 'CONNECTOR_TOKEN_KEY';

let cachedKey: Buffer | null | undefined;
let warnedMissing = false;

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
  // Fallback: derive 32 bytes via scrypt με σταθερό salt (idempotent ανάμεσα σε deploys)
  cachedKey = scryptSync(raw, 'pp.connector.token.salt.v1', 32);
  return cachedKey;
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Encrypt plaintext. Idempotent: αν είναι ήδη encrypted, επιστρέφεται ως έχει.
 * Αν λείπει το master key, επιστρέφει το plaintext με warning (fail-open).
 */
export function encryptToken(plaintext: string | null | undefined): string {
  if (!plaintext) return '';
  if (isEncrypted(plaintext)) return plaintext;
  const key = loadKey();
  if (!key) {
    if (!warnedMissing) {
      logger.warn(`[tokenCrypto] ${KEY_ENV} not configured — connector tokens will be stored in plaintext`);
      warnedMissing = true;
    }
    return plaintext;
  }
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 }) as CipherGCM;
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([enc, tag]);
    return `${PREFIX}${nonce.toString('base64url')}:${payload.toString('base64url')}`;
  } catch (err) {
    logger.error('[tokenCrypto] encrypt failed (fail-open, returning plaintext):', err);
    return plaintext;
  }
}

/**
 * Decrypt encrypted string OR pass-through plaintext (backward compatibility).
 * Επιστρέφει '' σε περίπτωση error για να σπάει controlled (όχι throw).
 */
export function decryptToken(value: string | null | undefined): string {
  if (!value) return '';
  if (!isEncrypted(value)) return value;
  const key = loadKey();
  if (!key) {
    logger.error(`[tokenCrypto] cannot decrypt — ${KEY_ENV} missing. Token will appear empty.`);
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
    logger.error('[tokenCrypto] decrypt failed:', err);
    return '';
  }
}
