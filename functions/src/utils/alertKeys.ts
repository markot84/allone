/**
 * Catalog of distinct alert keys.
 *
 * Every alertable log (`logger.error` / `logger.alert` / `logger.warnAlert`) should pass an
 * `alertKey` from here. The key is the unit of dedup in Cloud Monitoring: the alert policy is
 * grouped by `alertKey`, so each distinct key is its own incident series. Declaring them upfront
 * (instead of free-text at call sites) means typos don't silently fragment a series, and the set
 * of things that can page is reviewable in one place.
 *
 * Naming: `snake_case`, grouped by source file / domain. Keep one key per *distinct failure
 * location* — reuse the same key for retries of the same logical failure.
 *
 * Client-originated alerts live in src/utils/alertKeys.ts (prefixed `client_`) and share the
 * same Monitoring metric namespace.
 */
export const ALERT = {
  // ── Generic / shared ──────────────────────────────────────────────────────
  unkeyed: 'unkeyed', // fallback; mirrors UNKEYED_ALERT in logger.ts

  // ── index.ts: nightly waves & scheduled jobs ──────────────────────────────
  nightlyWaveFailed: 'nightly_wave_failed',
  nightlySyncFollowupsFailed: 'nightly_sync_followups_failed',
  nightlyAggregatesFailed: 'nightly_aggregates_failed',
  scheduledDataAnalysisRfmFailed: 'scheduled_data_analysis_rfm_failed',
  scheduledProductIntelligenceFailed: 'scheduled_product_intelligence_failed',
  scheduledAlertsFailed: 'scheduled_alerts_failed',
  scheduledDigestFailed: 'scheduled_digest_failed',
  syncJobProcessingFailed: 'sync_job_processing_failed',
  healthWatchStaleJob: 'health_watch_stale_job',

  // ── index.ts: HTTP endpoints ──────────────────────────────────────────────
  importDataFailed: 'import_data_failed',
  fetchImportUrlFailed: 'fetch_import_url_failed',
  generateApiKeyFailed: 'generate_api_key_failed',
  connectorAuthFailed: 'connector_auth_failed',
  connectorCallbackFailed: 'connector_callback_failed',
  connectorDisconnectFailed: 'connector_disconnect_failed',
  connectorSelectAccountFailed: 'connector_select_account_failed',
  connectorSyncFailed: 'connector_sync_failed',
  connectorSaveCredentialsFailed: 'connector_save_credentials_failed',
  ga4PeriodTotalsFailed: 'ga4_period_totals_failed',
  importMagentoSearchTermsFailed: 'import_magento_search_terms_failed',
  clientErrorSinkFailed: 'client_error_sink_failed',

  // ── Connectors (one key family per integration) ───────────────────────────
  ga4SyncFailed: 'ga4_sync_failed',
  googleAdsSyncFailed: 'google_ads_sync_failed',
  searchConsoleSyncFailed: 'search_console_sync_failed',
  metaSyncFailed: 'meta_sync_failed',
  tiktokSyncFailed: 'tiktok_sync_failed',
  shopifySyncFailed: 'shopify_sync_failed',
  woocommerceSyncFailed: 'woocommerce_sync_failed',
  magentoSyncFailed: 'magento_sync_failed',
  opencartSyncFailed: 'opencart_sync_failed',
  megaventorySyncFailed: 'megaventory_sync_failed',
  merchantSyncFailed: 'merchant_sync_failed',
  softoneSyncFailed: 'softone_sync_failed',
  entersoftSyncFailed: 'entersoft_sync_failed',
  epsilonNetSyncFailed: 'epsilon_net_sync_failed',

  // ── Aggregators / analytics ───────────────────────────────────────────────
  aggregateStatsFailed: 'aggregate_stats_failed',
  productIntelligenceFailed: 'product_intelligence_failed',
  dataAnalysisRfmFailed: 'data_analysis_rfm_failed',
  ecommerceAggregateFailed: 'ecommerce_aggregate_failed',
  stockMovementTrackFailed: 'stock_movement_track_failed',
  procurementSignalsFailed: 'procurement_signals_failed',
  competitorMonitorFailed: 'competitor_monitor_failed',

  // ── Notifications / alerts ────────────────────────────────────────────────
  emailSendFailed: 'email_send_failed',
  smtpConnectFailed: 'smtp_connect_failed',
  dailyDigestFailed: 'daily_digest_failed',
  serverAlertEvalFailed: 'server_alert_eval_failed',
  interestLeadFailed: 'interest_lead_failed',

  // ── Security / crypto / infra ─────────────────────────────────────────────
  tokenCryptoFailed: 'token_crypto_failed',
  oauthStateFailed: 'oauth_state_failed',
  rateLimitBackendFailed: 'rate_limit_backend_failed',
  corsBlocked: 'cors_blocked',
} as const;

export type AlertKey = (typeof ALERT)[keyof typeof ALERT];
