/**
 * Global setup for the Cloud Functions unit suite (Node 22).
 *
 * Provides deterministic env so security modules under test have their secrets
 * "present" by default. Individual suites may override (e.g. delete
 * CONNECTOR_TOKEN_KEY to exercise the fail-closed path) — `vi.stubEnv` /
 * per-test mutation is expected there.
 */
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-test';
process.env.FUNCTIONS_EMULATOR = process.env.FUNCTIONS_EMULATOR || 'true';

// A valid 64-hex (32-byte) AES key for tokenCrypto, BUILT from a low-entropy
// repeating placeholder so NO high-entropy secret literal sits in the source for
// scanners to flag. Test-only — NOT a real key; tokenCrypto just needs a valid
// 64-hex key present. ('deadbeef' × 8 = 64 hex chars.)
process.env.CONNECTOR_TOKEN_KEY =
  process.env.CONNECTOR_TOKEN_KEY || 'deadbeef'.repeat(8);

// Fake outbound-API secrets so handler code that reads them doesn't crash at import.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-key';
