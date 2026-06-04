/**
 * playwright.config.ts — Configuration for the Performance+ E2E smoke layer.
 *
 * Mirrors the sibling repo (Contlia) approach: a thin, always-runnable smoke
 * suite that hits a *deployed* base URL. There is no local web server here —
 * the tests target an already-running deployment.
 *
 * SAFETY: baseURL defaults to the STAGING deployment and must NEVER point at
 * production (performance-plus-4a5b2 / performanceplus.gr). Override only with
 * E2E_BASE_URL when you intentionally want a different STAGING-class target.
 */

import { defineConfig, devices } from '@playwright/test';

// Staging only. Do not change this fallback to a production URL.
const STAGING_BASE_URL = 'https://performanceplus-staging.web.app';

const baseURL = process.env.E2E_BASE_URL?.trim() || STAGING_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  // One retry smooths over cold-start / transient network flakiness against a
  // remote deployment without masking real, repeatable failures.
  retries: 1,
  // Capture a trace only when a test fails and is retried — cheap on green runs,
  // useful for debugging the occasional flake.
  trace: 'on-first-retry',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
