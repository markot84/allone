/**
 * Per-invocation request correlation id.
 *
 * Prefer GCP's trace id (from `X-Cloud-Trace-Context: <traceId>/<spanId>;o=1`) so our
 * `requestId` lines up with the trace Cloud Logging already attaches; otherwise mint one.
 * Attach the returned id (via `runWithLogContext`) so a single user action is traceable
 * across log lines.
 *
 * This codebase is Firebase Functions **v2**:
 *  - `onRequest` handlers receive the Express `Request` directly → pass it here for the trace id.
 *  - `onSchedule` (Pub/Sub) handlers have no inbound HTTP headers → call with no arg to mint `req_…`.
 */
import { randomBytes } from 'crypto';
import type { Request } from 'firebase-functions/v2/https';

/** Minimal shape we read — accepts a v2 `Request` or anything exposing `headers`. */
interface HasHeaders {
  headers?: Record<string, string | string[] | undefined>;
}

export function getRequestId(req?: Request | HasHeaders): string {
  const headers = req?.headers || {};
  const traceRaw = headers['x-cloud-trace-context'] ?? headers['X-Cloud-Trace-Context'];
  const trace = Array.isArray(traceRaw) ? traceRaw[0] : traceRaw;
  if (trace && typeof trace === 'string') {
    // Format: TRACE_ID/SPAN_ID;o=TRACE_TRUE — we want TRACE_ID.
    const traceId = trace.split('/')[0]?.trim();
    if (traceId) return traceId;
  }
  return 'req_' + randomBytes(8).toString('hex');
}
