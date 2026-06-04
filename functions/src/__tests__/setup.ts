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

// 64 hex chars = a direct 32-byte AES-256 key (tokenCrypto's preferred form).
// Test-only constant — NOT a real key.
process.env.CONNECTOR_TOKEN_KEY =
  process.env.CONNECTOR_TOKEN_KEY ||
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

// Fake outbound-API secrets so handler code that reads them doesn't crash at import.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-key';
