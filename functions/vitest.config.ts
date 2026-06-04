import { defineConfig } from 'vitest/config';

// Cloud Functions unit tests (Node 22). Security-sensitive PURE logic
// (urlValidator/tokenCrypto/oauthState/security) is tested here without an
// emulator; anything needing Firestore is mocked. See internal/TEST-PLAN.md §4.2.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
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
