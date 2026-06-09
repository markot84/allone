/**
 * Tiny module-level holder for the current signed-in user's uid, plus a per-tab session id.
 *
 * It exists so the client logger (src/utils/logger.ts) can stamp `userId` / `requestId` on every
 * log line WITHOUT importing src/config/firebase.ts (which would risk a circular import). The
 * single writer is the onAuthStateChanged listener in AuthContext, which calls `setCurrentUid`.
 * Everything else only reads. Leaf module: imports nothing local.
 */

let currentUid: string | null = null;

/** Called by AuthContext whenever auth state changes. */
export function setCurrentUid(uid: string | null): void {
  currentUid = uid || null;
}

/** Current signed-in user's raw uid, or null when signed out / pre-auth. */
export function getCurrentUid(): string | null {
  return currentUid;
}

let clientRequestId: string | null = null;

/** Stable per-tab session id so all client logs from one browser session correlate. */
export function getClientRequestId(): string {
  if (typeof window === 'undefined') return 'ssr';
  if (clientRequestId) return clientRequestId;
  clientRequestId =
    'web_' +
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36));
  return clientRequestId;
}
