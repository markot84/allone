/**
 * `computeBenchmarkCohorts` against the real module + Firestore emulator.
 *
 * The unit suite covers the maths; what it cannot reach is the write path, and that is where the
 * behaviour people actually see lives — which brands get a verdict document, which cohorts get
 * published, and which get deleted. A brand with no e-shop used to get no document at all, so the
 * report told the user "not computed yet" about a run that had completed and skipped it on purpose.
 * That regression is the first test here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';

import { computeBenchmarkCohorts, BENCHMARK_MIN_COHORT_BRANDS, __testables } from '../../benchmarkAggregator';

const PROJECT_ID = 'demo-test';
const { lastCompleteMonth, monthWindow } = __testables;

let db: admin.firestore.Firestore;

/** Twelve complete months of equal revenue ending last month, so the brand is size-bandable. */
function trailingYear(perMonth: number): Record<string, number> {
  return monthWindow(lastCompleteMonth(new Date()), 12).reduce<Record<string, number>>((acc, month) => {
    acc[month] = perMonth;
    return acc;
  }, {});
}

async function seedBrand(id: string, fields: Record<string, unknown> = {}) {
  await db.doc(`brands/${id}`).set({ name: id, createdBy: 'tester', ...fields });
}

/** A shop that clears both qualifying gates: enough orders, and revenue in the trailing year. */
async function seedQualifyingShop(id: string, aov: number, fields: Record<string, unknown> = {}) {
  await seedBrand(id, fields);
  await db.doc(`ecommerce_summary/${id}`).set({
    aov,
    orderCount: 900,
    revenueByMonth: trailingYear(60_000), // 720k TTM → `mid`
    revenueBySalesChannel: { direct_eshop: 900, marketplace_skroutz: 100 },
  });
}

async function wipe() {
  for (const coll of ['brands', 'ecommerce_summary', 'benchmark_self', 'benchmark_cohorts', 'data_analysis_rfm']) {
    const snap = await db.collection(coll).get();
    for (const d of snap.docs) await d.ref.delete();
  }
}

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  db = admin.firestore();
});

afterAll(async () => {
  await admin.app().delete();
});

beforeEach(wipe);

async function selfDoc(brandId: string) {
  const snap = await db.doc(`benchmark_self/${brandId}`).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : null;
}

describe('computeBenchmarkCohorts (real module, Firestore emulator)', () => {
  it('gives a brand with no e-shop an explicit "no", not an absent document', async () => {
    await seedBrand('no-shop');

    const result = await computeBenchmarkCohorts();

    expect(result.samples).toBe(0);
    const self = await selfDoc('no-shop');
    // The regression: this used to be null, which the report read as "never computed".
    expect(self).not.toBeNull();
    expect(self!.eligible).toBe(false);
    expect(self!.reason).toBe('insufficient_data');
    expect(self!.cohortChain).toEqual([]);
  });

  it('publishes nothing below the k floor, and says so through an empty cohort chain', async () => {
    await seedQualifyingShop('solo', 50, { vertical: 'sports' });

    const result = await computeBenchmarkCohorts();

    expect(result.samples).toBe(1);
    expect(result.cohorts).toBe(0);
    expect((await db.collection('benchmark_cohorts').get()).size).toBe(0);

    const self = await selfDoc('solo');
    // It qualified — it is simply alone, which is a different thing from having no data.
    expect(self!.eligible).toBe(true);
    expect(self!.cohortChain).toEqual([]);
  });

  it('publishes once the floor is met, and points each brand at its own cohort', async () => {
    for (let i = 0; i < BENCHMARK_MIN_COHORT_BRANDS; i += 1) {
      await seedQualifyingShop(`shop-${i}`, 40 + i * 5, { vertical: 'sports' });
    }

    const result = await computeBenchmarkCohorts();

    expect(result.samples).toBe(BENCHMARK_MIN_COHORT_BRANDS);
    expect(result.cohorts).toBeGreaterThan(0);

    const cohort = await db.doc('benchmark_cohorts/sports__mid').get();
    expect(cohort.exists).toBe(true);
    const data = cohort.data() as Record<string, never>;
    expect(data.brandCount).toBe(BENCHMARK_MIN_COHORT_BRANDS);
    expect((data.metrics as Record<string, { n: number }>).aov.n).toBe(BENCHMARK_MIN_COHORT_BRANDS);
    // No brand identity and no absolute revenue may appear in a document every tenant can read.
    const serialised = JSON.stringify(data);
    expect(serialised).not.toContain('shop-0');
    expect(serialised).not.toContain('720000');

    const self = await selfDoc('shop-0');
    expect(self!.cohortChain).toContain('sports__mid');
  });

  it('withdraws an opted-out brand from both sides: no sample, and no comparison of its own', async () => {
    for (let i = 0; i < BENCHMARK_MIN_COHORT_BRANDS; i += 1) {
      await seedQualifyingShop(`shop-${i}`, 40 + i * 5, { vertical: 'sports' });
    }
    await seedQualifyingShop('refuser', 99, { vertical: 'sports', benchmarkOptOut: true });

    const result = await computeBenchmarkCohorts();

    expect(result.samples).toBe(BENCHMARK_MIN_COHORT_BRANDS);
    const cohort = await db.doc('benchmark_cohorts/sports__mid').get();
    expect((cohort.data() as { brandCount: number }).brandCount).toBe(BENCHMARK_MIN_COHORT_BRANDS);

    const self = await selfDoc('refuser');
    expect(self!.eligible).toBe(false);
    expect(self!.reason).toBe('opted_out');
  });

  it('deletes a cohort that falls back under the floor instead of serving yesterday\'s numbers', async () => {
    for (let i = 0; i < BENCHMARK_MIN_COHORT_BRANDS; i += 1) {
      await seedQualifyingShop(`shop-${i}`, 40 + i * 5, { vertical: 'sports' });
    }
    await computeBenchmarkCohorts();
    expect((await db.doc('benchmark_cohorts/sports__mid').get()).exists).toBe(true);

    // One shop disconnects its e-shop; the cohort is now four.
    await db.doc('ecommerce_summary/shop-0').delete();
    await computeBenchmarkCohorts();

    expect((await db.doc('benchmark_cohorts/sports__mid').get()).exists).toBe(false);
    const self = await selfDoc('shop-1');
    expect(self!.cohortChain).toEqual([]);
  });
});
