/** Public-endpoint defenses: strict CORS allow-list + Firestore sliding-window rate limiting. Fail-open by default so the limiter never becomes a single point of failure. */
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from './utils/logger';

// `GCLOUD_PROJECT` is set by the Functions runtime/emulator; no fallback —
// fail early so a function never starts without a clear project context.
const PROJECT_ID = process.env.GCLOUD_PROJECT;
if (!PROJECT_ID) {
  throw new Error('[security] GCLOUD_PROJECT is not set — refusing to start without a project id');
}

const PROD_ORIGINS = [
  `https://${PROJECT_ID}.web.app`,
  `https://${PROJECT_ID}.firebaseapp.com`,
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

/** Applies strict allow-list CORS; returns true if the request ended here (OPTIONS preflight or rejected origin) and the caller must return. */
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
  // Foreign origin (header present) → block. Server-to-server calls (empty origin) are allowed.
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
    // Use the rightmost IP — appended by GCP's load balancer and unforgeable;
    // the leftmost is user-supplied and trivially spoofable.
    const ips = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    const rightmost = ips[ips.length - 1];
    if (rightmost) return rightmost;
  }
  return (req as unknown as { ip?: string }).ip || 'unknown';
}

/** Sliding-window rate limiter; doc schema: rate_limits/{safeKey} → { hits: number[] (ms), updatedAt }. */
/** Hard ceiling for the rate-limit transaction: hangs >5s (e.g. grpc cold-start) fail-open rather than burning the function deadline into `DEADLINE_EXCEEDED`. */
const RATE_LIMIT_HARD_TIMEOUT_MS = 5000;

export async function enforceRateLimit(opts: {
  key: string;
  limit: number;
  windowSeconds: number;
  /** On transaction fail/hang, deny instead of fail-open. Used on costly paths (geminiProxy) so a Firestore outage can't open unlimited use of the paid key. */
  failClosed?: boolean;
}): Promise<{ allowed: boolean; remaining: number; resetInSeconds: number }> {
  const db = getFirestore();
  const safeKey = opts.key.replace(/[^A-Za-z0-9_\-:.]/g, '_').slice(0, 160);
  const ref = db.doc(`rate_limits/${safeKey}`);
  const now = Date.now();
  const windowStart = now - opts.windowSeconds * 1000;

  // Result when the limiter cannot decide (timeout/exception).
  // Default: fail-open so it does not become a single point of failure. failClosed: deny.
  const degraded = {
    allowed: !opts.failClosed,
    remaining: opts.failClosed ? 0 : opts.limit,
    resetInSeconds: opts.windowSeconds,
  };

  const txPromise = db.runTransaction(async (tx) => {
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

  const mode = opts.failClosed ? 'fail-closed/deny' : 'fail-open';
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<typeof degraded>((resolve) => {
    timer = setTimeout(() => {
      logger.warn(`[RateLimit] ${safeKey} hard-timeout ${RATE_LIMIT_HARD_TIMEOUT_MS}ms (${mode})`);
      resolve(degraded);
    }, RATE_LIMIT_HARD_TIMEOUT_MS);
  });

  try {
    return await Promise.race([txPromise, timeoutPromise]);
  } catch (e) {
    logger.warn(`[RateLimit] ${safeKey} transaction failed (${mode}):`, { err: e });
    return degraded;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Returns a 429 response with an informative body. */
export function sendRateLimitExceeded(res: Response, resetInSeconds: number, scope: string): void {
  res.set('Retry-After', String(resetInSeconds));
  res.status(429).json({
    error: `Πολλά αιτήματα — δοκιμάστε ξανά σε ${resetInSeconds}s.`,
    scope,
  });
}
