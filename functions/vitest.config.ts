import { defineConfig } from 'vitest/config';

// Cloud Functions unit tests (Node 22): pure logic (urlValidator/tokenCrypto/oauthState/security),
// no emulator, Firestore mocked. See internal/TEST-PLAN.md §4.2.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    // Integration tests need the Firestore emulator — run via the `test:integration` config.
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
