/**
 * Client-side logger (browser).
 *
 * Usage:
 *   import { logger } from '../utils/logger';
 *   import { CLIENT_ALERT } from '../utils/alertKeys';
 *   logger.error('failed to load brands', { alertKey: CLIENT_ALERT.brandLoadFailed, err });
 *
 * debug/info are dev-only (stripped from intent in prod via the isProd guard). warn always
 * logs locally. error logs locally AND — if an `alertKey` is present — forwards to the backend
 * sink `logClientError` (fire-and-forget) so it flows through the same Slack alert pipeline.
 */
import { getCurrentUid, getClientRequestId } from './authState';

const isProd = import.meta.env.PROD;

const SENSITIVE_KEY_RE =
  /(email|e[-_]?mail|password|passwd|secret|token|accesstoken|refreshtoken|apikey|api[-_]?key|authorization|cookie)/i;

/** `john.doe@example.com` -> `j***@e***`. */
export function redactEmail(value: unknown): string {
  const s = String(value ?? '');
  const at = s.indexOf('@');
  if (at <= 0) return s ? '[redacted]' : '';
  const head = (str: string) => (str ? str[0] + '***' : '***');
  return `${head(s.slice(0, at))}@${head(s.slice(at + 1))}`;
}

function redactString(s: string): string {
  return String(s ?? '')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[key]')
    .replace(/\bsk-[a-zA-Z0-9]{20,}\b/g, '[key]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{10,}\b/gi, 'Bearer [token]');
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err == null) return {};
  if (err instanceof Error) {
    const anyErr = err as Error & { code?: unknown };
    return {
      name: err.name,
      message: redactString(err.message),
      ...(anyErr.code != null ? { code: String(anyErr.code) } : {}),
    };
  }
  return { message: redactString(String(err)) };
}

export function redact(ctx: unknown, depth = 0): unknown {
  if (ctx == null) return ctx;
  if (depth > 6) return '[depth]';
  if (typeof ctx === 'string') return redactString(ctx);
  if (typeof ctx !== 'object') return ctx;
  if (Array.isArray(ctx)) return ctx.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx as Record<string, unknown>)) {
    if (key === 'err' || key === 'error') {
      out[key] = serializeError(value);
      continue;
    }
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = /email/i.test(key) ? redactEmail(value) : '[redacted]';
      continue;
    }
    out[key] = redact(value, depth + 1);
  }
  return out;
}

type LogContext = Record<string, unknown> | undefined;

/** Merge ambient {userId, requestId} into a log context (explicit values in ctx win). */
function withAmbient(ctx: LogContext): Record<string, unknown> {
  const base = (ctx as Record<string, unknown>) || {};
  return {
    userId: 'userId' in base ? base.userId : getCurrentUid(),
    requestId: 'requestId' in base ? base.requestId : getClientRequestId(),
    ...base,
  };
}

function fmt(message: string, ctx: LogContext): unknown[] {
  return [message, redact(withAmbient(ctx))];
}

let forwarding = false; // guard: never recurse if the forward itself errors

/**
 * Best-effort: forward a handled error to the backend sink (logClientError). Browser-only,
 * fire-and-forget. PerformancePlus functions are HTTP `onRequest` (not callables), so we POST
 * with the App Check header — mirroring src/services/geminiProxy.ts.
 */
function forwardClientError(message: string, ctx: LogContext): void {
  if (typeof window === 'undefined' || forwarding) return;
  const c = (ctx || {}) as Record<string, unknown>;
  const alertKey = typeof c.alertKey === 'string' ? c.alertKey : undefined;
  if (!alertKey) return; // only forward keyed errors (opt-in per call site)
  const errObj = (c.err ?? c.error) as { stack?: unknown; name?: unknown; code?: unknown } | undefined;
  forwarding = true;
  void (async () => {
    try {
      const [{ FUNCTIONS_BASE_URL, getAppCheckHeader }, { getAuth }] = await Promise.all([
        import('../config/firebase'),
        import('firebase/auth'),
      ]);
      const url = `${FUNCTIONS_BASE_URL.replace(/\/$/, '')}/logClientError`;
      const idToken = await getAuth().currentUser?.getIdToken().catch(() => undefined);
      const appCheck = await getAppCheckHeader();
      await fetch(url, {
        method: 'POST',
        keepalive: true, // survive page unload
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          ...appCheck,
        },
        body: JSON.stringify({
          message,
          alertKey,
          context: {
            page: window.location?.pathname,
            stack: typeof errObj?.stack === 'string' ? errObj.stack : undefined,
            name: typeof errObj?.name === 'string' ? errObj.name : undefined,
            code: errObj?.code != null ? String(errObj.code) : undefined,
            // Correlate the server-side log line back to this browser session.
            requestId: getClientRequestId(),
          },
        }),
      });
    } catch {
      // swallow — never let logging break the app
    } finally {
      forwarding = false;
    }
  })();
}

export const logger = {
  debug: (message: string, ctx?: LogContext) => {
    if (!isProd) console.debug(...fmt(message, ctx));
  },
  info: (message: string, ctx?: LogContext) => {
    if (!isProd) console.info(...fmt(message, ctx));
  },
  warn: (message: string, ctx?: LogContext) => {
    console.warn(...fmt(message, ctx));
  },
  error: (message: string, ctx?: LogContext) => {
    console.error(...fmt(message, ctx));
    forwardClientError(message, ctx);
  },
};

export type Logger = typeof logger;
