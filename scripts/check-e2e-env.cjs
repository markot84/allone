#!/usr/bin/env node
/**
 * check-e2e-env.cjs — Pre-flight guard for the Playwright E2E smoke layer.
 *
 * Verifies that the credentials/config the E2E run needs are present in the
 * environment (or in a local .env.local, if one exists) WITHOUT ever printing
 * the values themselves. It prints booleans only ("<VAR> present: true|false")
 * and exits non-zero when a required var is missing, so `npm run test:e2e`
 * fails fast and loud rather than launching a browser that can't log in.
 *
 * SECURITY: this file must NEVER echo a secret. It reads .env.local purely to
 * decide presence; the parsed values are kept local and only their boolean
 * presence is reported. .env.local is gitignored.
 *
 * CommonJS (.cjs) on purpose: it runs under plain `node` outside the Vite/TS
 * build, so it must not depend on ESM or TypeScript tooling.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Required for an authenticated E2E run. The smoke spec itself does NOT log in,
// but the broader suite (test:e2e:all) does, so we guard on these centrally.
const REQUIRED_VARS = ['E2E_TEST_EMAIL', 'E2E_TEST_PASSWORD'];
// Optional: overrides the staging baseURL. Absence is fine (config has a default).
const OPTIONAL_VARS = ['E2E_BASE_URL'];

/**
 * Minimal .env parser. Returns a map of KEY -> true for every key that has a
 * non-empty value. We deliberately do NOT return the values: callers only ever
 * need to know presence, which keeps secrets from flowing further than needed.
 *
 * @param {string} filePath
 * @returns {Record<string, boolean>}
 */
function readEnvFilePresence(filePath) {
  /** @type {Record<string, boolean>} */
  const presence = {};
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return presence; // No file (or unreadable) -> nothing to add.
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!key) continue;

    let value = trimmed.slice(eq + 1).trim();
    // Strip a single layer of matching surrounding quotes.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    presence[key] = value.length > 0;
  }

  return presence;
}

/**
 * Resolve presence for a var: process.env wins, then .env.local. We never read
 * or compare the actual value beyond emptiness.
 *
 * @param {string} name
 * @param {Record<string, boolean>} filePresence
 * @returns {boolean}
 */
function isPresent(name, filePresence) {
  const fromEnv = process.env[name];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return true;
  return filePresence[name] === true;
}

function main() {
  const envLocalPath = path.resolve(__dirname, '..', '.env.local');
  const filePresence = readEnvFilePresence(envLocalPath);

  console.log(`.env.local found: ${fs.existsSync(envLocalPath)}`);

  const missing = [];

  for (const name of REQUIRED_VARS) {
    const present = isPresent(name, filePresence);
    // Booleans only — never the value.
    console.log(`${name} present: ${present}`);
    if (!present) missing.push(name);
  }

  for (const name of OPTIONAL_VARS) {
    const present = isPresent(name, filePresence);
    console.log(`${name} present: ${present} (optional)`);
  }

  if (missing.length > 0) {
    console.error(
      `\nMissing required E2E env var(s): ${missing.join(', ')}. ` +
        'Set them in the environment or in .env.local (gitignored). ' +
        'Target STAGING only — never production.'
    );
    process.exit(1);
  }

  console.log('\nAll required E2E env vars present.');
  process.exit(0);
}

main();
