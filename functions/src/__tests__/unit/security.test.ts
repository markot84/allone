/** Tests for functions/src/security.ts: CORS allow-list, getClientIp, and rate-limiter fail-open/closed.
 * Firestore mocked; setup.ts provides GCLOUD_PROJECT for PROD_ORIGINS. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';

// --- Mocks -----------------------------------------------------------------

// Controllable Firestore: tests reassign `runTransactionImpl` per case.
let runTransactionImpl: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
const docMock = vi.fn(() => ({ __ref: true }));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: docMock,
    runTransaction: (fn: (tx: unknown) => Promise<unknown>) => runTransactionImpl(fn),
  }),
  FieldValue: {
    serverTimestamp: () => '__serverTimestamp__',
  },
}));

const verifyTokenMock = vi.fn();
vi.mock('firebase-admin/app-check', () => ({ getAppCheck: () => ({ verifyToken: verifyTokenMock }) }));

vi.mock('firebase-functions/v2', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Import after mocks are registered.
import {
  appCheckDenied,
  applyStrictCors,
  enforceRateLimit,
  getClientIp,
  resolveAllowedOrigin,
} from '../../security';

// GCLOUD_PROJECT is fixed by setup.ts; mirror it to build expected origins.
const PROJECT_ID = process.env.GCLOUD_PROJECT as string;

// --- Test helpers ----------------------------------------------------------

interface FakeRes {
  set: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    set: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
    send: vi.fn(),
  };
  // status() chains into .json()/.send().
  res.status.mockReturnValue(res);
  return res;
}

function makeReq(opts: {
  origin?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
}): Request {
  const headers: Record<string, string | string[] | undefined> = { ...opts.headers };
  if (opts.origin !== undefined) headers.origin = opts.origin;
  return {
    method: opts.method ?? 'POST',
    headers,
    ip: opts.ip,
  } as unknown as Request;
}

/** In-memory transaction: `seedHits` seeds the stored doc; `tx.set` captures the write for asserts. */
function makeTransactionRunner(seedHits: number[] | undefined) {
  const written: { value: Record<string, unknown> | null } = { value: null };
  const runner = async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: async () => ({
        data: () => (seedHits === undefined ? undefined : { hits: seedHits }),
      }),
      set: (_ref: unknown, value: Record<string, unknown>) => {
        written.value = value;
      },
    };
    return fn(tx);
  };
  return { runner, written };
}

beforeEach(() => {
  vi.useRealTimers();
  docMock.mockClear();
  // Default: a runner that behaves like an empty doc, so unrelated tests don't crash.
  runTransactionImpl = makeTransactionRunner(undefined).runner;
});

afterEach(() => {
  vi.useRealTimers();
});

// --- resolveAllowedOrigin --------------------------------------------------

describe('resolveAllowedOrigin', () => {
  it('echoes an allow-listed *.web.app prod origin', () => {
    const origin = `https://${PROJECT_ID}.web.app`;
    expect(resolveAllowedOrigin(origin)).toBe(origin);
  });

  it('echoes the performanceplus.gr prod origin', () => {
    expect(resolveAllowedOrigin('https://performanceplus.gr')).toBe('https://performanceplus.gr');
  });

  it('echoes the www. prod origin', () => {
    expect(resolveAllowedOrigin('https://www.performanceplus.gr')).toBe(
      'https://www.performanceplus.gr'
    );
  });

  it('echoes a Hosting preview-channel origin of this project', () => {
    const origin = `https://${PROJECT_ID}--ui-b-8dwn8buv.web.app`;
    expect(resolveAllowedOrigin(origin)).toBe(origin);
  });

  it('rejects a preview-channel origin belonging to another project', () => {
    expect(resolveAllowedOrigin('https://some-other-project--ui-b-8dwn8buv.web.app')).toBeNull();
  });

  it('rejects a look-alike host that merely starts with the project id', () => {
    expect(resolveAllowedOrigin(`https://${PROJECT_ID}--ui.web.app.evil.example`)).toBeNull();
    expect(resolveAllowedOrigin(`https://${PROJECT_ID}-ui-b.web.app`)).toBeNull();
    expect(resolveAllowedOrigin(`https://evil.${PROJECT_ID}--ui-b.web.app`)).toBeNull();
  });

  it('rejects a random evil origin', () => {
    expect(resolveAllowedOrigin('https://evil.example')).toBeNull();
  });

  it('returns null for an empty / undefined origin (server-to-server)', () => {
    expect(resolveAllowedOrigin('')).toBeNull();
    expect(resolveAllowedOrigin(undefined)).toBeNull();
  });

  it('allows a dev origin only when running under the emulator', () => {
    const prev = process.env.FUNCTIONS_EMULATOR;
    try {
      process.env.FUNCTIONS_EMULATOR = 'true';
      expect(resolveAllowedOrigin('http://localhost:5173')).toBe('http://localhost:5173');

      process.env.FUNCTIONS_EMULATOR = 'false';
      expect(resolveAllowedOrigin('http://localhost:5173')).toBeNull();
    } finally {
      process.env.FUNCTIONS_EMULATOR = prev;
    }
  });
});

// --- applyStrictCors -------------------------------------------------------

describe('applyStrictCors', () => {
  it('sets CORS headers and does NOT short-circuit for an allow-listed POST', async () => {
    const origin = `https://${PROJECT_ID}.web.app`;
    const req = makeReq({ origin, method: 'POST' });
    const res = makeRes();

    const handled = await applyStrictCors(req, res as unknown as Response);

    expect(handled).toBe(false); // caller continues processing
    expect(res.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', origin);
    expect(res.set).toHaveBeenCalledWith('Vary', 'Origin');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks a foreign origin with 403 and short-circuits', async () => {
    const req = makeReq({ origin: 'https://evil.example', method: 'POST' });
    const res = makeRes();

    const handled = await applyStrictCors(req, res as unknown as Response);

    expect(handled).toBe(true); // caller must return
    expect(res.set).not.toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      expect.anything()
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Origin not allowed' });
  });

  it('allows a server-to-server POST with no origin header (not short-circuited)', async () => {
    const req = makeReq({ method: 'POST' }); // no origin header
    const res = makeRes();

    const handled = await applyStrictCors(req, res as unknown as Response);

    expect(handled).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('answers an allow-listed OPTIONS preflight with 204 and short-circuits', async () => {
    const origin = `https://${PROJECT_ID}.firebaseapp.com`;
    const req = makeReq({ origin, method: 'OPTIONS' });
    const res = makeRes();

    const handled = await applyStrictCors(req, res as unknown as Response);

    expect(handled).toBe(true);
    expect(res.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', origin);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalledWith('');
  });

  it('answers a foreign-origin OPTIONS preflight with 403 and short-circuits', async () => {
    const req = makeReq({ origin: 'https://evil.example', method: 'OPTIONS' });
    const res = makeRes();

    const handled = await applyStrictCors(req, res as unknown as Response);

    expect(handled).toBe(true);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('');
  });
});

// --- getClientIp -----------------------------------------------------------

describe('getClientIp', () => {
  it('reads the rightmost IP from a comma-joined x-forwarded-for string', () => {
    // Leftmost is client-supplied/spoofable; rightmost is appended by GCP's LB.
    const req = makeReq({
      headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' },
    });
    expect(getClientIp(req)).toBe('3.3.3.3');
  });

  it('handles a single-value x-forwarded-for', () => {
    const req = makeReq({ headers: { 'x-forwarded-for': '9.9.9.9' } });
    expect(getClientIp(req)).toBe('9.9.9.9');
  });

  it('uses the first element when x-forwarded-for is an array, then its rightmost IP', () => {
    const req = makeReq({
      headers: { 'x-forwarded-for': ['4.4.4.4, 5.5.5.5', '6.6.6.6'] },
    });
    expect(getClientIp(req)).toBe('5.5.5.5');
  });

  it('falls back to req.ip when no x-forwarded-for header is present', () => {
    const req = makeReq({ ip: '7.7.7.7' });
    expect(getClientIp(req)).toBe('7.7.7.7');
  });

  it("returns 'unknown' when neither header nor req.ip is available", () => {
    const req = makeReq({});
    expect(getClientIp(req)).toBe('unknown');
  });
});

// --- enforceRateLimit ------------------------------------------------------

describe('enforceRateLimit', () => {
  describe('happy path (transaction succeeds)', () => {
    it('allows a request under the limit and decrements remaining', async () => {
      // limit 5, one existing recent hit → after this request, 2 hits stored.
      const { runner, written } = makeTransactionRunner([Date.now()]);
      runTransactionImpl = runner;

      const result = await enforceRateLimit({
        key: 'ip:1.2.3.4',
        limit: 5,
        windowSeconds: 60,
      });

      expect(result.allowed).toBe(true);
      // limit(5) - storedHits(2) = 3 remaining.
      expect(result.remaining).toBe(3);
      expect(result.resetInSeconds).toBe(60);
      // The new hit was persisted (2 entries: the seeded one + the new now).
      expect((written.value?.hits as number[]).length).toBe(2);
    });

    it('allows a first-ever request (empty doc) with remaining = limit - 1', async () => {
      const { runner } = makeTransactionRunner(undefined); // doc does not exist
      runTransactionImpl = runner;

      const result = await enforceRateLimit({
        key: 'ip:5.6.7.8',
        limit: 3,
        windowSeconds: 30,
      });

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it('denies a request that is at/over the limit and reports a reset window', async () => {
      const now = Date.now();
      // 5 recent hits already, limit 5 → over the limit.
      const { runner } = makeTransactionRunner([now - 1000, now, now, now, now]);
      runTransactionImpl = runner;

      const result = await enforceRateLimit({
        key: 'ip:9.9.9.9',
        limit: 5,
        windowSeconds: 60,
      });

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.resetInSeconds).toBeGreaterThan(0);
    });

    it('drops hits older than the sliding window before counting', async () => {
      const now = Date.now();
      // Two stale hits (well outside a 60s window) + nothing recent → allowed.
      const stale = now - 10 * 60 * 1000;
      const { runner } = makeTransactionRunner([stale, stale]);
      runTransactionImpl = runner;

      const result = await enforceRateLimit({
        key: 'ip:1.1.1.1',
        limit: 2,
        windowSeconds: 60,
      });

      expect(result.allowed).toBe(true);
      // Stale hits pruned → only the new hit stored → remaining = 2 - 1 = 1.
      expect(result.remaining).toBe(1);
    });
  });

  describe('fail modes — Firestore error', () => {
    it('fail-OPEN by default: a transaction error returns allowed:true', async () => {
      runTransactionImpl = () => Promise.reject(new Error('FIRESTORE UNAVAILABLE'));

      const result = await enforceRateLimit({
        key: 'ip:1.2.3.4',
        limit: 10,
        windowSeconds: 60,
        // no failClosed → default fail-open
      });

      expect(result.allowed).toBe(true);
      // degraded fail-open exposes the full limit as remaining.
      expect(result.remaining).toBe(10);
      expect(result.resetInSeconds).toBe(60);
    });

    it('fail-CLOSED when failClosed:true: a transaction error returns allowed:false', async () => {
      runTransactionImpl = () => Promise.reject(new Error('FIRESTORE UNAVAILABLE'));

      const result = await enforceRateLimit({
        key: 'gemini:brandX',
        limit: 10,
        windowSeconds: 60,
        failClosed: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe('fail modes — Firestore hard-timeout', () => {
    it('fail-OPEN by default: a transaction that hangs past the hard timeout returns allowed:true', async () => {
      vi.useFakeTimers();
      // A transaction that never resolves → only the hard-timeout can settle the race.
      runTransactionImpl = () => new Promise<never>(() => {});

      const promise = enforceRateLimit({
        key: 'ip:slow',
        limit: 7,
        windowSeconds: 90,
      });

      // Advance past RATE_LIMIT_HARD_TIMEOUT_MS (5000ms) to fire the timeout branch.
      await vi.advanceTimersByTimeAsync(5001);
      const result = await promise;

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(7);
      expect(result.resetInSeconds).toBe(90);
    });

    it('fail-CLOSED when failClosed:true: a hanging transaction returns allowed:false after the hard timeout', async () => {
      vi.useFakeTimers();
      runTransactionImpl = () => new Promise<never>(() => {});

      const promise = enforceRateLimit({
        key: 'gemini:slow',
        limit: 7,
        windowSeconds: 90,
        failClosed: true,
      });

      await vi.advanceTimersByTimeAsync(5001);
      const result = await promise;

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe('key sanitization', () => {
    it('sanitizes unsafe characters in the rate-limit doc key', async () => {
      const { runner } = makeTransactionRunner(undefined);
      runTransactionImpl = runner;

      await enforceRateLimit({
        key: 'ip:1.2.3.4/../weird key!',
        limit: 5,
        windowSeconds: 60,
      });

      expect(docMock).toHaveBeenCalledTimes(1);
      const path = docMock.mock.calls[0][0] as unknown as string;
      // Unsafe chars (/, space, !) replaced with underscores; safe ip:.- kept.
      expect(path).toBe('rate_limits/ip:1.2.3.4_.._weird_key_');
    });
  });
});

describe('appCheckDenied (PER-62)', () => {
  const call = (headers: Record<string, string>) => {
    const req = makeReq({ method: 'POST' });
    Object.assign(req.headers, headers);
    const res = makeRes();
    return { res, done: appCheckDenied(req, res as unknown as Response) };
  };

  afterEach(() => {
    delete process.env.APP_CHECK_ENFORCE;
    verifyTokenMock.mockReset();
  });

  it('is a no-op while enforcement is off — the default', async () => {
    const { res, done } = call({});
    expect(await done).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
    expect(verifyTokenMock).not.toHaveBeenCalled();
  });

  it('denies a missing token once enforced', async () => {
    process.env.APP_CHECK_ENFORCE = 'true';
    const { res, done } = call({});
    expect(await done).toBe(true);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('allows a valid token and denies a rejected one', async () => {
    process.env.APP_CHECK_ENFORCE = 'true';
    verifyTokenMock.mockResolvedValueOnce({ appId: 'app' });
    expect(await call({ 'x-firebase-appcheck': 'good' }).done).toBe(false);
    verifyTokenMock.mockRejectedValueOnce(new Error('bad token'));
    const bad = call({ 'x-firebase-appcheck': 'bad' });
    expect(await bad.done).toBe(true);
    expect(bad.res.status).toHaveBeenCalledWith(401);
  });
});
