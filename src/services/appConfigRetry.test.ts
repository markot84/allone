import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: vi.fn() }));
vi.mock('../config/firebase', () => ({ db: {} }));
vi.mock('./firestore', () => ({ withFirestoreRetry: (fn: () => unknown) => fn() }));

import { getDoc } from 'firebase/firestore';

describe('loadSuperAdmins (PER-303: no failure caching)', () => {
  beforeEach(() => vi.resetModules());

  it('rethrows on failure and succeeds on a later call instead of caching the empty result', async () => {
    const { loadSuperAdmins } = await import('./appConfig');
    vi.mocked(getDoc).mockRejectedValueOnce(new Error('client is offline'));
    await expect(loadSuperAdmins()).rejects.toThrow('client is offline');

    vi.mocked(getDoc).mockResolvedValueOnce({ exists: () => true, data: () => ({ uids: ['u1'], emails: [] }) } as never);
    await expect(loadSuperAdmins()).resolves.toEqual({ uids: ['u1'], emails: [] });
  });
});
