/**
 * Process-wide browser error capture.
 *
 * Installs `window.onerror` (uncaught exceptions) and `unhandledrejection` (dropped promise
 * rejections) listeners that route through the client logger → backend sink → Slack alert.
 * React render errors are handled separately by ErrorBoundary; these catch everything outside
 * the React tree (event handlers, async callbacks, third-party scripts).
 *
 * Call once at startup (main.tsx). A light client-side throttle keeps a tight error loop from
 * spamming; the backend sink is also flood-capped as a second line of defense.
 */
import { logger } from './logger';
import { CLIENT_ALERT } from './alertKeys';

const THROTTLE_MS = 10_000;
const lastSeen = new Map<string, number>();

/** Drop repeats of the same message within the throttle window. */
function shouldReport(key: string): boolean {
  const now = Date.now();
  const prev = lastSeen.get(key);
  if (prev != null && now - prev < THROTTLE_MS) return false;
  lastSeen.set(key, now);
  // Bound the map so a flood of distinct messages can't grow it unbounded.
  if (lastSeen.size > 100) lastSeen.clear();
  return true;
}

let installed = false;

export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    const msg = event.message || 'window.onerror';
    if (!shouldReport(`error:${msg}`)) return;
    logger.error('Uncaught window error', {
      alertKey: CLIENT_ALERT.windowError,
      err: event.error instanceof Error ? event.error : undefined,
      message: msg,
      source: event.filename,
      line: event.lineno,
      col: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const msg = reason instanceof Error ? reason.message : String(reason ?? 'unhandledrejection');
    if (!shouldReport(`reject:${msg}`)) return;
    logger.error('Unhandled promise rejection', {
      alertKey: CLIENT_ALERT.unhandledRejection,
      err: reason instanceof Error ? reason : undefined,
      message: msg,
    });
  });
}
