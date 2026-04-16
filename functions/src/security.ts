/**
 * Public-endpoint defenses: strict CORS (origin allow-list) και rate limiting
 * μέσω Firestore sliding window. Χρησιμοποιείται από endpoints που:
 *  - δέχονται δημόσιο traffic (submitInterestLead) ή
 *  - καλούν κοστοβόρα APIs (geminiProxy)
 *
 * Σημ.: fail-open policy — αν το Firestore transaction αποτύχει, αφήνουμε
 * το request να περάσει. Αυτό αποφεύγει να γίνει το ίδιο το rate limiter
 * single-point-of-failure (π.χ. outage → όλοι οι χρήστες blocked).
 */
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';

const PROD_ORIGINS = [
  'https://performance-plus-4a5b2.web.app',
  'https://performance-plus-4a5b2.firebaseapp.com',
  'https://performanceplus.gr',
  'https://www.performanceplus.gr',
];

const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

export function resolveAllowedOrigin(reqOrigin?: string): string | null {
  if (!reqOrigin) return null;
  if (PROD_ORIGINS.includes(reqOrigin)) return reqOrigin;
  if (process.env.FUNCTIONS_EMULATOR === 'true' && DEV_ORIGINS.includes(reqOrigin)) return reqOrigin;
  return null;
}

/**
 * Εφαρμόζει strict CORS με whitelist. Επιστρέφει true αν το request τελείωσε
 * εδώ (OPTIONS preflight ή rejected origin) — ο caller πρέπει να κάνει return.
 */
export function applyStrictCors(req: Request, res: Response): boolean {
  const origin = (req.headers.origin as string | undefined) || '';
  const allowed = resolveAllowedOrigin(origin);
  if (allowed) {
    res.set('Access-Control-Allow-Origin', allowed);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-AppCheck');
    res.set('Access-Control-Max-Age', '3600');
  }
  if (req.method === 'OPTIONS') {
    res.status(allowed ? 204 : 403).send('');
    return true;
  }
  // Ξένο origin (και υπάρχει header) → block. Server-to-server calls (origin κενό) επιτρέπονται.
  if (origin && !allowed) {
    logger.warn(`[CORS] blocked origin: ${origin}`);
    res.status(403).json({ error: 'Origin not allowed' });
    return true;
  }
  return false;
}

export function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  if (raw) {
    const first = String(raw).split(',')[0].trim();
    if (first) return first;
  }
  return (req as unknown as { ip?: string }).ip || 'unknown';
}

/**
 * Sliding-window rate limiter (Firestore doc per key).
 * Doc schema: rate_limits/{safeKey} → { hits: number[] (ms), updatedAt }
 */
export async function enforceRateLimit(opts: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<{ allowed: boolean; remaining: number; resetInSeconds: number }> {
  const db = getFirestore();
  const safeKey = opts.key.replace(/[^A-Za-z0-9_\-:.]/g, '_').slice(0, 160);
  const ref = db.doc(`rate_limits/${safeKey}`);
  const now = Date.now();
  const windowStart = now - opts.windowSeconds * 1000;
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data() as { hits?: number[] } | undefined;
      const hits = (data?.hits || []).filter((t) => t > windowStart);
      if (hits.length >= opts.limit) {
        const oldest = hits[0];
        return {
          allowed: false,
          remaining: 0,
          resetInSeconds: Math.max(1, Math.ceil((oldest + opts.windowSeconds * 1000 - now) / 1000)),
        };
      }
      hits.push(now);
      tx.set(
        ref,
        { hits, updatedAt: FieldValue.serverTimestamp(), ttl: new Date(now + 2 * opts.windowSeconds * 1000) },
        { merge: true }
      );
      return {
        allowed: true,
        remaining: Math.max(0, opts.limit - hits.length),
        resetInSeconds: opts.windowSeconds,
      };
    });
  } catch (e) {
    logger.warn(`[RateLimit] ${safeKey} transaction failed (fail-open):`, e);
    return { allowed: true, remaining: opts.limit, resetInSeconds: opts.windowSeconds };
  }
}

/**
 * Επιστρέφει 429 response με informative body.
 */
export function sendRateLimitExceeded(res: Response, resetInSeconds: number, scope: string): void {
  res.set('Retry-After', String(resetInSeconds));
  res.status(429).json({
    error: `Πολλά αιτήματα — δοκιμάστε ξανά σε ${resetInSeconds}s.`,
    scope,
  });
}
