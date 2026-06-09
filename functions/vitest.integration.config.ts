import { defineConfig } from 'vitest/config';

// PER-60: Megaventory sync INTEGRATION tests. Unlike the pure unit suite
// (vitest.config.ts), these run the real `fetchMegaventoryData` state machine
// against the Firestore emulator with a controllable clock (vi useFakeTimers
// toFake:['Date'] + setSystemTime) and a mocked Megaventory `fetch`.
//
// Driven by `npm run test:integration`, which wraps this in
// `firebase emulators:exec --only firestore` so the emulator is up. Kept out of
// the default `npm test` glob because it needs a live emulator.
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
