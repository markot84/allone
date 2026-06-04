/**
 * Shared harness for the Firestore security-rules suite.
 *
 * Boots a single `@firebase/rules-unit-testing` (v5) test environment against
 * the Firestore emulator that `npm run test:rules` spins up via
 * `firebase emulators:exec --only firestore`. The rules under test are the
 * real `firestore.rules` at the repo root — read fresh from disk so the suite
 * always exercises the deployed source, not a copy.
 *
 * Exposes:
 *   - `getTestEnv()` / `initEnv()` / `cleanupEnv()` — lifecycle (beforeAll/afterAll).
 *   - `clearFirestore()` — wipe all docs between tests (beforeEach).
 *   - `authed(uid, claims?)` — a Firestore handle for a signed-in user.
 *   - `unauth()` — a Firestore handle for an anonymous (signed-out) caller.
 *   - `seed(fn)` — run admin-context writes with security rules DISABLED, used
 *     to arrange fixtures (memberships, existing docs) the tests then probe.
 *   - re-exported `assertSucceeds` / `assertFails` from the testing lib.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import type {
  RulesTestEnvironment,
  RulesTestContext,
} from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';

export { assertSucceeds, assertFails };

const PROJECT_ID = 'demo-test';
const RULES_PATH = resolve(__dirname, '../../firestore.rules');

let testEnv: RulesTestEnvironment | null = null;

/** Boot the shared emulator-backed test environment (call in beforeAll). */
export async function initEnv(): Promise<RulesTestEnvironment> {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
  return testEnv;
}

/** The active environment; throws if `initEnv()` has not run. */
export function getTestEnv(): RulesTestEnvironment {
  if (!testEnv) {
    throw new Error('Test environment not initialized — call initEnv() in beforeAll.');
  }
  return testEnv;
}

/** Tear the environment down (call in afterAll). */
export async function cleanupEnv(): Promise<void> {
  if (testEnv) {
    await testEnv.cleanup();
    testEnv = null;
  }
}

/** Remove every document so each test starts from a clean slate (beforeEach). */
export async function clearFirestore(): Promise<void> {
  await getTestEnv().clearFirestore();
}

/**
 * Firestore handle authenticated as `uid`, optionally carrying custom auth
 * claims. Reads/writes through this handle are evaluated against the rules.
 */
export function authed(
  uid: string,
  claims?: Record<string, unknown>,
): Firestore {
  const ctx: RulesTestContext = getTestEnv().authenticatedContext(uid, claims);
  return ctx.firestore() as unknown as Firestore;
}

/** Firestore handle for an unauthenticated (signed-out) caller. */
export function unauth(): Firestore {
  const ctx: RulesTestContext = getTestEnv().unauthenticatedContext();
  return ctx.firestore() as unknown as Firestore;
}

/**
 * Arrange fixtures with security rules DISABLED (admin context). Use this to
 * seed memberships and pre-existing docs that the rule-checked assertions then
 * probe — never to assert behavior.
 */
export async function seed(
  fn: (db: Firestore) => Promise<void>,
): Promise<void> {
  await getTestEnv().withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore() as unknown as Firestore);
  });
}
