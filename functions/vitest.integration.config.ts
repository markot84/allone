import { defineConfig } from 'vitest/config';

// Megaventory sync integration tests: real `fetchMegaventoryData` vs Firestore emulator, fake Date clock, mocked `fetch`.
// Run via `npm run test:integration` (wraps `firebase emulators:exec`); excluded from default `npm test` (needs live emulator).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/integration/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    // Serialize — the emulator is shared mutable state across tests.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
