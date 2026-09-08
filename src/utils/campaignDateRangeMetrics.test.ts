/** The period filter and the period metrics must agree: a campaign kept for a window is exactly
 * one that can contribute a figure to it. Before this, a campaign whose declared schedule ended
 * in a past year was dropped even though the connectors had merged this year's daily metrics into
 * the same document — the window then reported €0 spend for days that really had spend. */
import { describe, expect, it } from 'vitest';
import {
  applyCampaignDateRangeToMetrics,
  filterCampaignsByScheduleDateOverlap,
} from './campaignDateRangeMetrics';
import { calculateCampaignMetrics } from './roiUtils';
import type { Campaign } from '../types';

const CUR = { from: '2026-08-05', to: '2026-09-03' };
const PREV = { from: '2025-08-05', to: '2025-09-03' };

function dailySpend(from: string, to: string, perDay: number) {
  const out: Record<string, { impressions: number; clicks: number; conversions: number; amount_spent: number; conversion_value: number }> = {};
  const day = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (day <= end) {
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    out[key] = { impressions: 100, clicks: 10, conversions: 1, amount_spent: perDay, conversion_value: perDay * 10 };
    day.setDate(day.getDate() + 1);
  }
  return out;
}

/** Both years in one document, exactly as the connectors store them. */
const bothYears = { ...dailySpend(PREV.from, PREV.to, 10), ...dailySpend(CUR.from, CUR.to, 8) };

function campaign(over: Partial<Campaign>): Campaign {
  return { id: 'c1', name: 'Campaign', channel: 'Google Ads', dailyMetrics: bothYears, ...over } as Campaign;
}

function spendInWindow(cs: Campaign[], from: string, to: string): number {
  return calculateCampaignMetrics(
    applyCampaignDateRangeToMetrics(filterCampaignsByScheduleDateOverlap(cs, from, to), from, to)
  ).totalSpend;
}

describe('filterCampaignsByScheduleDateOverlap — daily metrics outrank the declared schedule', () => {
  it('keeps a campaign whose schedule ended in a past year but has daily metrics in the window', () => {
    const c = campaign({ start_date: '2025-01-01', end_date: '2025-12-31' });
    expect(filterCampaignsByScheduleDateOverlap([c], CUR.from, CUR.to)).toHaveLength(1);
    expect(spendInWindow([c], CUR.from, CUR.to)).toBeCloseTo(30 * 8, 5);
  });

  it('keeps one whose `period` field spans a past year', () => {
    const c = campaign({ period: '2025-01-01 - 2025-12-31' });
    expect(spendInWindow([c], CUR.from, CUR.to)).toBeCloseTo(30 * 8, 5);
  });

  it('still drops a past campaign with no daily metrics inside the window', () => {
    const c = campaign({
      start_date: '2025-01-01',
      end_date: '2025-12-31',
      dailyMetrics: dailySpend(PREV.from, PREV.to, 10),
    });
    expect(filterCampaignsByScheduleDateOverlap([c], CUR.from, CUR.to)).toHaveLength(0);
    expect(spendInWindow([c], CUR.from, CUR.to)).toBe(0);
  });

  it('leaves ongoing and date-less campaigns as they were', () => {
    const ongoing = campaign({ start_date: '2025-01-01' });
    const undated = campaign({});
    expect(spendInWindow([ongoing], CUR.from, CUR.to)).toBeCloseTo(30 * 8, 5);
    expect(spendInWindow([undated], CUR.from, CUR.to)).toBeCloseTo(30 * 8, 5);
  });

  it('does not disturb the previous-year window', () => {
    const c = campaign({ start_date: '2025-01-01', end_date: '2025-12-31' });
    expect(spendInWindow([c], PREV.from, PREV.to)).toBeCloseTo(30 * 10, 5);
  });

  it('honours Meta legacy month buckets when deciding overlap', () => {
    const c = campaign({
      channel: 'Meta',
      start_date: '2025-01-01',
      end_date: '2025-12-31',
      dailyMetrics: {
        '2026-08-01': { impressions: 100, clicks: 10, conversions: 1, amount_spent: 310, conversion_value: 3100 },
      },
    });
    expect(filterCampaignsByScheduleDateOverlap([c], CUR.from, CUR.to)).toHaveLength(1);
    expect(spendInWindow([c], CUR.from, CUR.to)).toBeGreaterThan(0);
  });

  it('keeps a campaign with no daily metrics on its schedule alone, as before', () => {
    const c = campaign({ start_date: '2026-08-10', end_date: '2026-08-20', dailyMetrics: undefined });
    expect(filterCampaignsByScheduleDateOverlap([c], CUR.from, CUR.to)).toHaveLength(1);
    const past = campaign({ start_date: '2025-01-01', end_date: '2025-02-01', dailyMetrics: undefined });
    expect(filterCampaignsByScheduleDateOverlap([past], CUR.from, CUR.to)).toHaveLength(0);
  });
});
