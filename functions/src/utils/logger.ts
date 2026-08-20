/**
 * Structured logger over `firebase-functions/v2` logger.
 *
 * Drop-in replacement for `import { logger } from 'firebase-functions/v2'`:
 *  - `logger.info/warn/error/debug(message, ctx?)` — same call shape, now with redaction.
 *  - `logger.error/alert/warnAlert(message, { alertKey, err, ... })` — stamps `alertable:true`
 *    + `alertType` + `alertKey` + `env` so the Cloud Monitoring log-based metric picks it up
 *    and the alert policy notifies Slack, deduped per `alertKey`. See docs/manual-actions.md.
 *
 * Every line also gets ambient `userId` + `requestId` (from logContext) so a single user
 * action is traceable across log lines.
 */
import { logger as fnLogger } from 'firebase-functions/v2';
import { getLogContext } from './logContext';

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/** Keys whose values must never appear in logs (case-insensitive substring match). */
const SENSITIVE_KEY_RE =
  /(email|e[-_]?mail|password|passwd|secret|token|accesstoken|refreshtoken|apikey|api[-_]?key|authorization|cookie)/i;

/** `john.doe@example.com` -> `j***@e***` — enough to eyeball, not enough to identify. */
export function redactEmail(value: unknown): string {
  const s = String(value ?? '');
  const at = s.indexOf('@');
  if (at <= 0) return s ? '[redacted]' : '';
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const head = (str: string) => (str ? str[0] + '***' : '***');
  return `${head(local)}@${head(domain)}`;
}

/** Serialize an Error so we keep code + message + stack (no more `e?.message || e`). */
function serializeError(err: unknown): Record<string, unknown> {
  if (err == null) return {};
  if (err instanceof Error) {
    const anyErr = err as Error & { code?: unknown };
    return {
      name: err.name,
      message: redactString(err.message),
      ...(anyErr.code != null ? { code: String(anyErr.code) } : {}),
      ...(err.stack ? { stack: err.stack } : {}),
    };
  }
  return { message: redactString(String(err)) };
}

/** Scrub API-key shapes, obvious secrets, and email addresses out of a free-text string. */
export function redactString(s: string): string {
  return String(s ?? '')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[key]')
    .replace(/\bsk-[a-zA-Z0-9]{20,}\b/g, '[key]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{10,}\b/gi, 'Bearer [token]')
    .replace(/\benc:v1:[A-Za-z0-9+/=:]+/g, 'enc:v1:[token]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (m) => redactEmail(m));
}

/**
 * Deep-scrub a context object before it goes to logs.
 *  - `err`/`error` are always run through serializeError.
 *  - any key matching SENSITIVE_KEY_RE is masked.
 *  - strings are run through redactString to catch inline secrets.
 */
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

// ---------------------------------------------------------------------------
// Environment tag (so alerts/logs distinguish staging vs prod)
// ---------------------------------------------------------------------------

function envTag(): string {
  return (
    process.env.APP_ENV ||
    process.env.FUNCTIONS_ENV ||
    (process.env.FUNCTIONS_EMULATOR === 'true' ? 'emulator' : '') ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    'unknown'
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

type LogContext = Record<string, unknown> | undefined;

/** Fallback alertKey for alertable logs that don't pass one — all keyless alerts share this
 *  single series, so they still alert but dedupe together (one open incident, not silence). */
export const UNKEYED_ALERT = 'unkeyed';

export function resolveAlertKey(explicit?: unknown): string {
  const k = typeof explicit === 'string' ? explicit.trim() : '';
  return k || UNKEYED_ALERT;
}

/**
 * Emit a structured log line.
 * When `alertType` is set, the payload is stamped `alertable: true` + `alertType` + `alertKey`
 * + `env` so the log-based metric (jsonPayload.alertable=true) picks it up and the Monitoring
 * alert policy notifies Slack, deduped per `alertKey`.
 */
function emit(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  ctx: LogContext,
  alertType?: 'error' | 'user_negative',
): void {
  const safe = (redact(ctx ?? {}) as Record<string, unknown>) || {};
  // Ambient request context (uid + requestId) — stamped on every line so a single user
  // action is traceable. Explicit ctx values win; uid is null when unauthenticated.
  const reqCtx = getLogContext();
  const ambient: Record<string, unknown> = {
    userId: 'userId' in safe ? safe.userId : reqCtx ? reqCtx.uid : null,
    requestId: 'requestId' in safe ? safe.requestId : reqCtx ? reqCtx.requestId : null,
  };
  const payload: Record<string, unknown> = alertType
    ? {
        ...ambient,
        ...safe,
        alertable: true,
        alertType,
        alertKey: resolveAlertKey((ctx as Record<string, unknown> | undefined)?.alertKey),
        env: envTag(),
      }
    : { ...ambient, ...safe };
  // firebase-functions/v2 logger emits structured jsonPayload when passed an object arg.
  // The message string is redacted too — interpolated emails/tokens must never reach Cloud Logging.
  fnLogger[level](redactString(message), payload);
}

export const logger = {
  debug: (message: string, ctx?: LogContext) => emit('debug', message, ctx),
  info: (message: string, ctx?: LogContext) => emit('info', message, ctx),
  warn: (message: string, ctx?: LogContext) => emit('warn', message, ctx),
  /** Expected, self-correcting negative outcome. WARNING severity + `alertable` marker → Slack, deduped per `alertKey`. */
  warnAlert: (message: string, ctx?: LogContext) => emit('warn', message, ctx, 'user_negative'),
  /**
   * Exceptions / failures. ERROR severity + `alertable` marker → Slack via the alert policy.
   * Deduped per `alertKey` (pass `{ alertKey }` to group explicitly; missing → shared `unkeyed`).
   */
  error: (message: string, ctx?: LogContext) => emit('error', message, ctx, 'error'),
  /**
   * User-negative outcome that isn't necessarily an exception (quota exhausted, sync skipped,
   * degraded fallback). ERROR severity + `alertable` marker → Slack.
   * Deduped per `alertKey` (pass `{ alertKey }` to group explicitly).
   */
  alert: (message: string, ctx?: LogContext) => emit('error', message, ctx, 'user_negative'),
};

export type Logger = typeof logger;
