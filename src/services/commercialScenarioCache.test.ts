// PER-309: v9→v10 bump must invalidate BOTH cache layers (poisoned empty payloads).
import { describe, expect, it, vi } from 'vitest';
import { readScenarioCache, readScenarioCacheRemote, writeScenarioCache } from './commercialScenarioCache';
import { FirestoreService } from './firestore';

vi.mock('./firestore', () => ({
  FirestoreService: { getDocument: vi.fn().mockResolvedValue(null), setDocument: vi.fn(), deleteDocument: vi.fn() },
}));

// Node test env: give the service a real-enough localStorage (it guards on window).
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal('window', { localStorage });

describe('scenario cache v10 bump', () => {
  it('ignores raw v9 localStorage entries and writes v10 keys', () => {
    localStorage.setItem(
      'pp-erp-scenario-v9:e-tennis:2025-06-01:2025-07-31',
      JSON.stringify({ savedAt: Date.now(), data: { orderCount: 0 } })
    );
    expect(readScenarioCache('e-tennis', '2025-06-01', '2025-07-31')).toBeNull();
    writeScenarioCache('e-tennis', '2025-06-01', '2025-07-31', { fresh: true });
    expect(localStorage.getItem('pp-erp-scenario-v10:e-tennis:2025-06-01:2025-07-31')).toBeTruthy();
  });

  it('remote doc id carries __v10 (guards against a half-bump)', async () => {
    await readScenarioCacheRemote('e-tennis', '2025-06-01', '2025-07-31');
    const docId = vi.mocked(FirestoreService.getDocument).mock.calls[0]?.[1];
    expect(String(docId)).toContain('__v10');
  });
});
