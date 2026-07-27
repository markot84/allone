/** E2E smoke suite hitting a deployed base URL (no local web server).
 * SAFETY: baseURL defaults to STAGING, must NEVER point at production; override only via E2E_BASE_URL with a STAGING-class target. */

import { defineConfig, devices } from '@playwright/test';

// Staging only. Do not change this fallback to a production URL.
const STAGING_BASE_URL = 'https://allone-9e685.web.app';

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
