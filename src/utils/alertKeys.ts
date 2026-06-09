/**
 * Client-side alert keys.
 *
 * Browser errors forwarded to the backend sink (`logClientError`) carry one of these keys.
 * All are prefixed `client_` so they share the same Cloud Monitoring metric namespace as the
 * backend keys (functions/src/utils/alertKeys.ts) while staying distinguishable. The key is the
 * unit of dedup — same key = one incident series.
 *
 * Only `logger.error(msg, { alertKey })` forwards to the backend (opt-in per call site); `warn`
 * stays local. Keep the set small and meaningful — every key here can page someone.
 */
export const CLIENT_ALERT = {
  // React error boundaries
  errorBoundaryCaught: 'client_error_boundary_caught',
  chunkLoadFailed: 'client_chunk_load_failed',

  // Global handlers
  windowError: 'client_window_error',
  unhandledRejection: 'client_unhandled_rejection',

  // Data / service calls that, when they fail, the user feels it
  brandLoadFailed: 'client_brand_load_failed',
  authActionFailed: 'client_auth_action_failed',
  connectorSyncCallFailed: 'client_connector_sync_call_failed',
  aggregatesCallFailed: 'client_aggregates_call_failed',
  dataImportFailed: 'client_data_import_failed',
  aiAssistantFailed: 'client_ai_assistant_failed',

  // Fallback for forwarded errors without an explicit key
  unkeyed: 'client_unkeyed',
} as const;

export type ClientAlertKey = (typeof CLIENT_ALERT)[keyof typeof CLIENT_ALERT];
