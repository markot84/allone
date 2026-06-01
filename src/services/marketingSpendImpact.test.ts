import { describe, it, expect } from 'vitest';
import { analyzeMarketingDecisions } from './marketingSpendImpact';
import type { Campaign } from '../types';

type Daily = Record<string, { amount_spent: number; conversion_value: number; conversions: number }>;

function campaign(id: string, dailyMetrics: Daily): Campaign {
  return {
    id,
    name: id,
    channel: 'Google Ads',
    amount_spent: 0,
    dailyMetrics,
  } as unknown as Campaign;
}

// Period = Απρίλιος 2026 → baseline (default) = προηγούμενο ισόποσο διάστημα (02–31 Μαρ).
const periodFrom = '2026-04-01';
const periodTo = '2026-04-30';
const BEFORE_DAY = '2026-03-15';
const AFTER_DAY = '2026-04-15';

function run(campaigns: Campaign[]) {
  return analyzeMarketingDecisions({
    campaigns,
    orders: [],
    periodFrom,
    periodTo,
    costBySku: new Map(),
  });
}

function rowFor(res: ReturnType<typeof run>, id: string) {
  const row = res.rows.find((r) => r.id === id);
  if (!row) throw new Error(`row ${id} not found`);
  return row;
}

describe('analyzeMarketingDecisions', () => {
  it('scale_up που κράτησε το ROAS → Επιτυχία', () => {
    const c = campaign('up_ok', {
      [BEFORE_DAY]: { amount_spent: 100, conversion_value: 400, conversions: 10 },
      [AFTER_DAY]: { amount_spent: 200, conversion_value: 760, conversions: 19 },
    });
    const row = rowFor(run([c]), 'up_ok');
    expect(row.decisionType).toBe('scale_up');
    expect(row.decisionLabel).toBe('Budget +100%');
    expect(row.spendBefore).toBe(100);
    expect(row.spend).toBe(200);
    expect(row.roasBefore).toBe(4);
    expect(row.roas).toBe(3.8);
    expect(row.verdict).toBe('positive');
  });

  it('scale_up που γκρέμισε το ROAS → Αποτυχία', () => {
    const c = campaign('up_bad', {
      [BEFORE_DAY]: { amount_spent: 100, conversion_value: 800, conversions: 20 },
      [AFTER_DAY]: { amount_spent: 300, conversion_value: 420, conversions: 12 },
    });
    const row = rowFor(run([c]), 'up_bad');
    expect(row.decisionType).toBe('scale_up');
    expect(row.roas).toBe(1.4);
    expect(row.verdict).toBe('negative');
  });

  it('νέα καμπάνια με καλό ROAS → Επιτυχία (launch)', () => {
    const c = campaign('launch_ok', {
      [AFTER_DAY]: { amount_spent: 150, conversion_value: 600, conversions: 15 },
    });
    const row = rowFor(run([c]), 'launch_ok');
    expect(row.decisionType).toBe('launch');
    expect(row.decisionLabel).toBe('Νέα καμπάνια');
    expect(row.spendBefore).toBe(0);
    expect(row.verdict).toBe('positive');
  });

  it('διακοπή καμπάνιας που απέδιδε → Αποτυχία (paused)', () => {
    const c = campaign('paused_bad', {
      [BEFORE_DAY]: { amount_spent: 200, conversion_value: 800, conversions: 20 },
    });
    const row = rowFor(run([c]), 'paused_bad');
    expect(row.decisionType).toBe('paused');
    expect(row.decisionLabel).toBe('Διακοπή');
    expect(row.roasBefore).toBe(4);
    expect(row.spend).toBe(0);
    expect(row.verdict).toBe('negative');
  });

  it('scale_down χωρίς απώλεια τζίρου → Επιτυχία', () => {
    const c = campaign('down_ok', {
      [BEFORE_DAY]: { amount_spent: 200, conversion_value: 600, conversions: 15 },
      [AFTER_DAY]: { amount_spent: 100, conversion_value: 580, conversions: 14 },
    });
    const row = rowFor(run([c]), 'down_ok');
    expect(row.decisionType).toBe('scale_down');
    expect(row.decisionLabel).toBe('Budget −50%');
    expect(row.verdict).toBe('positive');
  });

  it('αγνοεί καμπάνιες χωρίς ουσιαστικό spend σε κανένα παράθυρο', () => {
    const c = campaign('tiny', {
      [AFTER_DAY]: { amount_spent: 5, conversion_value: 20, conversions: 1 },
    });
    expect(run([c]).rows).toHaveLength(0);
  });

  it('summary μετρά επιτυχίες/αποτυχίες και blended ROAS', () => {
    const res = run([
      campaign('a', {
        [BEFORE_DAY]: { amount_spent: 100, conversion_value: 400, conversions: 10 },
        [AFTER_DAY]: { amount_spent: 200, conversion_value: 760, conversions: 19 },
      }),
      campaign('b', {
        [BEFORE_DAY]: { amount_spent: 100, conversion_value: 800, conversions: 20 },
        [AFTER_DAY]: { amount_spent: 300, conversion_value: 420, conversions: 12 },
      }),
    ]);
    expect(res.summary.detected).toBe(2);
    expect(res.summary.positive).toBe(1);
    expect(res.summary.negative).toBe(1);
    expect(res.summary.totalSpend).toBe(500);
    expect(res.summary.blendedRoas).toBe(2.36); // (760+420)/500
  });
});
