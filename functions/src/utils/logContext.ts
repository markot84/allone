/**
 * Per-invocation ambient log context.
 *
 * Each HTTP/scheduled handler opens a context once at entry; `logger.*` then stamps
 * `userId` + `requestId` onto every log line emitted during that invocation — no need to
 * thread them through call sites. `userId` is null for unauthenticated / scheduled work.
 */
import { AsyncLocalStorage } from 'async_hooks';

export interface LogContext {
  uid: string | null;
  requestId: string;
}

const storage = new AsyncLocalStorage<LogContext>();

/** Run `fn` with the given log context bound for the duration of the (async) call tree. */
export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Current ambient log context, or undefined when called outside a bound handler. */
export function getLogContext(): LogContext | undefined {
  return storage.getStore();
}
