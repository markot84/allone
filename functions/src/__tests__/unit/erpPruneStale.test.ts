/** erpPruneStale deletes only the brand's docs a snapshot run left untouched — never another brand's,
 *  and never docs the run just wrote. */
import { describe, it, expect } from 'vitest';
import { erpPruneStale } from '../../erpConnectorFirestore';

type Doc = { id: string; brandId: string; updatedAt: Date };

/** Minimal Firestore stand-in: supports where(brandId==)/where(updatedAt<)/select/limit/get + batch delete. */
function fakeDb(docs: Doc[]) {
  const store = new Map(docs.map((d) => [d.id, d]));
  const queries: number[] = [];
  const collection = () => {
    const conds: { brandId?: string; before?: Date } = {};
    let cap = Infinity;
    const q = {
      where(field: string, _op: string, value: unknown) {
        if (field === 'brandId') conds.brandId = value as string;
        else conds.before = value as Date;
        return q;
      },
      select: () => q,
      limit(n: number) { cap = n; return q; },
      get: async () => {
        const hits = [...store.values()]
          .filter((d) => d.brandId === conds.brandId && d.updatedAt < (conds.before as Date))
          .slice(0, cap);
        queries.push(hits.length);
        return { empty: hits.length === 0, size: hits.length, docs: hits.map((d) => ({ ref: { id: d.id } })) };
      },
    };
    return q;
  };
  const db = {
    collection,
    batch: () => {
      const pending: string[] = [];
      return { delete: (ref: { id: string }) => pending.push(ref.id), commit: async () => pending.forEach((id) => store.delete(id)) };
    },
  };
  return { db, store, queries };
}

const T0 = new Date('2026-08-05T10:00:00Z');
const older = (id: string, brandId: string) => ({ id, brandId, updatedAt: new Date('2026-06-01T00:00:00Z') });
const fresh = (id: string, brandId: string) => ({ id, brandId, updatedAt: new Date('2026-08-05T10:00:05Z') });

describe('erpPruneStale', () => {
  it('deletes only stale docs of the given brand', async () => {
    const { db, store } = fakeDb([older('a', 'safeblock'), fresh('b', 'safeblock'), older('c', 'other')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deleted = await erpPruneStale(db as any, 'softone_items', 'safeblock', T0);
    expect(deleted).toBe(1);
    expect([...store.keys()].sort()).toEqual(['b', 'c']);
  });

  it('is a no-op when the run touched everything', async () => {
    const { db, store, queries } = fakeDb([fresh('a', 'safeblock'), fresh('b', 'safeblock')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await erpPruneStale(db as any, 'softone_items', 'safeblock', T0)).toBe(0);
    expect(store.size).toBe(2);
    expect(queries).toEqual([0]); // single query, no delete batch
  });

  it('pages past the 500-doc batch limit', async () => {
    const many = Array.from({ length: 1200 }, (_, i) => older(`s${i}`, 'safeblock'));
    const { db, store } = fakeDb([...many, fresh('keep', 'safeblock')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await erpPruneStale(db as any, 'softone_items', 'safeblock', T0)).toBe(1200);
    expect([...store.keys()]).toEqual(['keep']);
  });
});

describe('erpPruneStale failure handling', () => {
  it('never throws — a failed prune must not fail the sync', async () => {
    const db = { collection: () => { throw new Error('index building'); } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(erpPruneStale(db as any, 'softone_items', 'safeblock', T0)).resolves.toBe(0);
  });
});
