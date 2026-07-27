import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Frontend Vitest config — kept SEPARATE from `vite.config.ts` on purpose.
//
// `vite.config.ts` throws when `VITE_FIREBASE_PROJECT_ID` is unset (a build-time
// guard). Tests must not depend on a real, gitignored `.env`, so this config is
// self-contained: env is mocked in `src/test/setup.ts` and the test graph never
// reaches a live Firebase backend. (Isolation principle — see internal/TEST-PLAN.md.)
//
// The emulator-backed Firestore rules tests live under `tests/rules/**` and use
// their OWN config (`vitest.rules.config.ts`) because they connect to the
// Firestore emulator rather than running as plain Node unit tests.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    // Co-located unit tests only. tests/rules/** is excluded — it runs under the
    // emulator via `npm run test:rules`.
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'functions', 'tests/rules', 'e2e'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.ts',
        'src/test/**',
        'src/**/*.d.ts',
        'src/generated/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
});
