import { defineConfig } from 'vitest/config';

// Cloud Functions unit tests (Node 22). Security-sensitive PURE logic
// (urlValidator/tokenCrypto/oauthState/security) is tested here without an
// emulator; anything needing Firestore is mocked. See internal/TEST-PLAN.md §4.2.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    // PER-60: integration tests need the Firestore emulator — run them via the
    // dedicated `test:integration` config, not the plain unit run.
    exclude: ['src/__tests__/integration/**', '**/node_modules/**'],
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/**/*.d.ts'],
    },
  },
});
