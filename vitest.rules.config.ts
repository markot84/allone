import { defineConfig } from 'vitest/config';

// Firestore *rules* tests — run against the Firestore emulator via
// `@firebase/rules-unit-testing`. Driven by `npm run test:rules`, which wraps
// this in `firebase emulators:exec --only firestore` so the emulator is up.
//
// Kept separate from `vitest.config.ts` because these are NOT plain Node unit
// tests: they need a live emulator and must not load `src/test/setup.ts` (which
// mocks the client Firebase env). Single worker — the emulator is shared state.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    // Rules suites mutate shared emulator state; serialize to avoid cross-test races.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
