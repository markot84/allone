/**
 * Global Vitest setup for the frontend unit suite (loaded via `setupFiles` in
 * `vitest.config.ts`, runs once per worker before any test module is imported).
 *
 * Purpose: ISOLATION. Tests must never read a real (gitignored) `.env` or reach a
 * live Firebase backend. We stub the six SDK keys that `src/config/firebase.ts`
 * requires at import time with harmless demo values, so any service that
 * transitively imports the Firebase bootstrap initializes against a throwaway
 * project that is never contacted over the network in unit tests.
 */
import { afterEach, vi } from 'vitest';

// The six keys `requireEnv()` in src/config/firebase.ts demands. Demo values —
// they configure an in-memory Firebase app that unit tests never call out on.
vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-api-key');
vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'demo-test.firebaseapp.com');
vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-test');
vi.stubEnv('VITE_FIREBASE_STORAGE_BUCKET', 'demo-test.appspot.com');
vi.stubEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', '000000000000');
vi.stubEnv('VITE_FIREBASE_APP_ID', '1:000000000000:web:test');
// App Check stays OFF in tests (blank site key) — mirrors the gated default.
vi.stubEnv('VITE_RECAPTCHA_V3_SITE_KEY', '');

// Keep mocks from leaking across tests without unstubbing env (which must persist
// for the whole run, since modules read it once at import time).
afterEach(() => {
  vi.clearAllMocks();
});
