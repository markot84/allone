/**
 * Unit tests for the budget-opportunity engine (`computeBudgetOpportunities`).
 *
 * The engine compares a "recent" window against a "baseline" window built from
 * `Campaign.dailyMetrics`, and emits budget suggestions (scale_up / scale_test /
 * reduce / review) per campaign — and, optionally, per channel rollup.
 *
 * Window math (with a fixed `referenceDate`, default 7/7 days):
 *   ref      = referenceDate @ noon
 *   recentEnd   = ref - 1 day                       (yesterday — platforms finalize overnight)
 *   recentStart = recentEnd   - (recentDays   - 1)
 *   baselineEnd = recentStart - 1
 *   baselineStart = baselineEnd - (baselineDays - 1)
 *
 * For `referenceDate = 2026-02-01` (recentDays=baselineDays=7):
 *   baseline = 2026-01-18 .. 2026-01-24
 *   recent   = 2026-01-25 .. 2026-01-31
 *
 * Tests build dailyMetrics on dates inside those windows and assert the
 * classification, confidence, ordering, suggested deltas, and meta counters.
 */
import { describe, expect, it } from 'vitest';
import { makeCampaign, makeCampaignDaily } from '../test/helpers';
import type { Campaign } from '../types';
import type { BudgetSuggestionKind } from '../types/budgetSuggestions';
import { computeBudgetOpportunities } from './budgetOpportunityEngine';

/** Fixed reference so the recent/baseline windows are deterministic.
 * Use Date(y, m, d) — local midnight — so the engine's setHours(12) lands on the
 * correct calendar date regardless of the machine timezone (UTC strings parse as UTC
 * midnight, which drifts to the prior day in UTC- timezones). */
const REF = new Date(2026, 1, 1); // Feb 1, 2026 local midnight

/** Dates that fall inside the baseline window (2026-01-18 .. 2026-01-24). */
const BASELINE_DATES = ['2026-01-18', '2026-01-19', '2026-01-20', '2026-01-21'] as const;
/** Dates that fall inside the recent window (2026-01-25 .. 2026-01-31). */
const RECENT_DATES = ['2026-01-25', '2026-01-26', '2026-01-27', '2026-01-28'] as const;

type DailyMetrics = NonNullable<Campaign['dailyMetrics']>;

/**
 * Spread `spend`/`revenue`/`conversions` evenly across `dates`, one daily row
 * each (so each contributes 1 active day when spend > 0.01).
 */
function spreadDaily(
  dates: readonly string[],
  totals: { spend: number; revenue: number; conversions?: number; clicks?: number; impressions?: number },
): DailyMetrics {
  const n = dates.length;
  const out: DailyMetrics = {};
  for (const date of dates) {
    out[date] = makeCampaignDaily({
      amount_spent: totals.spend / n,
      conversion_value: totals.revenue / n,
      conversions: (totals.conversions ?? 0) / n,
      clicks: (totals.clicks ?? 0) / n,
      impressions: (totals.impressions ?? 0) / n,
    });
  }
  return out;
}

/**
 * A campaign whose recent vs baseline windows realize the given totals.
 * `recentActiveDays` / `baselineActiveDays` control how many distinct dates
 * carry spend (drives the confidence tier).
 */
function makeWindowedCampaign(opts: {
  id?: string;
  name?: string;
  channel?: Campaign['channel'];
  recent: { spend: number; revenue: number; conversions?: number };
  baseline: { spend: number; revenue: number; conversions?: number };
  recentActiveDays?: number;
  baselineActiveDays?: number;
}): Campaign {
  const rDays = RECENT_DATES.slice(0, opts.recentActiveDays ?? 4);
  const bDays = BASELINE_DATES.slice(0, opts.baselineActiveDays ?? 4);
  const dailyMetrics: DailyMetrics = {
    ...spreadDaily(rDays, opts.recent),
    ...spreadDaily(bDays, opts.baseline),
  };
  return makeCampaign({
    id: opts.id ?? 'c1',
    name: opts.name ?? 'Campaign 1',
    channel: opts.channel ?? 'Google Ads',
    dailyMetrics,
  });
}

describe('computeBudgetOpportunities', () => {
  describe('empty / no-daily inputs', () => {
    it('returns no suggestions for an empty campaign list', () => {
      const result = computeBudgetOpportunities([], { referenceDate: REF });
      expect(result.suggestions).toEqual([]);
      expect(result.meta.campaignsWithDailyMetrics).toBe(0);
      expect(result.meta.campaignsSkippedNoDaily).toBe(0);
    });

    it('counts campaigns without dailyMetrics as skipped, not analyzed', () => {
      const campaigns = [
        makeCampaign({ id: 'no-dm' }),
        makeCampaign({ id: 'empty-dm', dailyMetrics: {} }),
      ];
      const result = computeBudgetOpportunities(campaigns, { referenceDate: REF });
      expect(result.suggestions).toEqual([]);
      expect(result.meta.campaignsWithDailyMetrics).toBe(0);
      expect(result.meta.campaignsSkippedNoDaily).toBe(2);
    });

    it('ignores daily rows that fall outside both windows', () => {
      // All spend sits well before the baseline window -> windows are empty.
      const campaign = makeCampaign({
        id: 'stale',
        dailyMetrics: {
          '2025-12-01': makeCampaignDaily({ amount_spent: 500, conversion_value: 2000 }),
          '2025-12-02': makeCampaignDaily({ amount_spent: 500, conversion_value: 2000 }),
        },
      });
      const result = computeBudgetOpportunities([campaign], { referenceDate: REF });
      // Campaign has dailyMetrics (so it's counted), but both windows sum to 0 -> below min -> no suggestion.
      expect(result.meta.campaignsWithDailyMetrics).toBe(1);
      expect(result.suggestions).toEqual([]);
    });
  });

  describe('minimum-spend gate', () => {
    it('emits nothing when recent spend is below minSpendPerWindow', () => {
      const campaign = makeWindowedCampaign({
        recent: { spend: 10, revenue: 100, conversions: 5 }, // below default min 25
        baseline: { spend: 100, revenue: 300, conversions: 10 },
      });
      const result = computeBudgetOpportunities([campaign], { referenceDate: REF });
      expect(result.suggestions).toEqual([]);
    });

    it('emits nothing when baseline spend is below minSpendPerWindow', () => {
      const campaign = makeWindowedCampaign({
        recent: { spend: 100, revenue: 500, conversions: 10 },
        baseline: { spend: 10, revenue: 30, conversions: 1 }, // below default min 25
      });
      const result = computeBudgetOpportunities([campaign], { referenceDate: REF });
      expect(result.suggestions).toEqual([]);
    });

    it('honors a custom (raised) minSpendPerWindow', () => {
      const campaign = makeWindowedCampaign({
        recent: { spend: 100, revenue: 1000, conversions: 50 },
        baseline: { spend: 100, revenue: 300, conversions: 40 },
      });
      // With min=200, both windows (spend 100) fall below the gate -> nothing.
      const result = computeBudgetOpportunities([campaign], {
        referenceDate: REF,
        minSpendPerWindow: 200,
      });
      expect(result.suggestions).toEqual([]);
    });
  });

  describe('classification rules', () => {
    it('classifies a clear ROAS improvement (with held conversions) as scale_up', () => {
      // recent ROAS = 1000/100 = 10x ; baseline ROAS = 300/100 = 3x -> 10 >= 3*1.08.
      // recent conversions (50) >= baseline (40) * 0.85 = 34 -> scale_up wins.
      const campaign = makeWindowedCampaign({
        recent: { spend: 100, revenue: 1000, conversions: 50 },
        baseline: { spend: 100, revenue: 300, conversions: 40 },
      });
      const result = computeBudgetOpportunities([campaign], { referenceDate: REF });
      expect(result.suggestions).toHaveLength(1);
      const s = result.suggestions[0];
      expect(s.kind).toBe<BudgetSuggestionKind>('scale_up');
      expect(s.scope).toBe('campaign');
      expect(s.suggestedBudgetDeltaPercent).toEqual({ min: 10, max: 25 });
      expect(s.metrics.recent.roas).toBeCloseTo(10);
      expect(s.metrics.baseline.roas).toBeCloseTo(3);
    });

    it('does NOT scale_up when ROAS improved but conversions collapsed', () => {
      // recent ROAS 10x vs baseline 3x improves, but recent conversions (5) <
      // baseline (40)*0.85 = 34, so the scale_up conversion guard fails.
      // recent ROAS (10) is not <= baseline*0.85, and recent.spend(100) is not < min*1.5(37.5),
      // so it is neither reduce nor scale_test -> no suggestion.
      const campaign = makeWindowedCampaign({
        recent: { spend: 100, revenue: 1000, conversions: 5 },
        baseline: { spend: 100, revenue: 300, conversions: 40 },
      });
      const result = computeBudgetOpportunities([campaign], { referenceDate: REF });
      expect(result.suggestions).toEqual([]);
    });

    it('classifies a sharp ROAS decline as reduce with a negative delta range', () => {
      // recent ROAS = 100/100 = 1x ; baseline ROAS = 500/100 = 5x.
      // 1 <= 5 * 0.85 (= 4.25) -> reduce.
      const campaign = makeWindowedCampaign({
        recent: { spend: 100, revenue: 100, conversions: 5 },
        baseline: { spend: 100, revenue: 500, conversions: 20 },
      });
      const result = computeBudgetOpportunities([campaign], { referenceDate: REF });
      expect(result.suggestions).toHaveLength(1);
      const s = result.suggestions[0];
      expect(s.kind).toBe<BudgetSuggestionKind>('reduce');
      expect(s.suggestedBudgetDeltaPercent).toEqual({ min: -30, max: -10 });
    });

    it('classifies modest improvement with low recent spend as scale_test', () => {
      // baseline ROAS = 30/30 = 1 (spend just above min 25). recent ROAS = 80/30 = 2.67x.
      // 2.67 >= 1*1.08 but conversions guard: recent(3) < baseline(40)*0.85 -> not scale_up.
      // not reduce (2.67 not <= 0.85). scale_test: rr>=br*1.03, recent.spend(30) < min*1.5(37.5), rr>=2 -> scale_test.
      const campaign = makeWindowedCampaign({
        recent: { spend: 30, revenue: 80, conversions: 3 },
        baseline: { spend: 30, revenue: 30, conversions: 40 },
      });
      const result = computeBudgetOpportunities([campaign], { referenceDate: REF });
      expect(result.suggestions).toHaveLength(1);
      const s = result.suggestions[0];
      expect(s.kind).toBe<BudgetSuggestionKind>('scale_test');
      expect(s.suggestedBudgetDeltaPercent).toEqual({ min: 5, max: 15 });
    });

    it('classifies a previously-dead baseline that now performs as review', () => {
      // baseline revenue 0 -> baseline ROAS 0 ; recent ROAS > 0 -> review.
      const campaign = makeWindowedCampaign({
        recent: { spend: 100, revenue: 400, conversions: 10 },
        baseline: { spend: 100, revenue: 0, conversions: 0 },
      });
      const result = computeBudgetOpportunities([campaign], { referenceDate: REF });
      expect(result.suggestions).toHaveLength(1);
      const s = result.suggestions[0];
      expect(s.kind).toBe<BudgetSuggestionKind>('review');
      // review carries no suggested delta range.
      expect(s.suggestedBudgetDeltaPercent).toBeUndefined();
    });

    it('emits no suggestion for stable performance (hold-equivalent)', () => {
      // recent ROAS = 320/100 = 3.2x ; baseline ROAS = 300/100 = 3x.
      // 3.2 >= 3*1.08 (=3.24)? no. reduce? 3.2 <= 3*0.85? no. scale_test needs recent.spend < 37.5 (it's 100). -> null.
      const campaign = makeWindowedCampaign({
        recent: { spend: 100, revenue: 320, conversions: 10 },
        baseline: { spend: 100, revenue: 300, conversions: 10 },
      });
      const result = computeBudgetOpportunities([campaign], { referenceDate: REF });
      expect(result.suggestions).toEqual([]);
    });
  });

  describe('confidence tiers', () => {
    it('marks confidence high when both windows have >= minActiveDaysHighConfidence active days', () => {
      // default minActiveDaysHighConfidence = 4; spread spend over all 4 dates in each window.
      const campaign = makeWindowedCampaign({
        recent: { spend: 100, revenue: 1000, conversions: 50 },
        baseline: { spend: 100, revenue: 300, conversions: 40 },
        recentActiveDays: 4,
        baselineActiveDays: 4,
      });
      const result = computeBudgetOpportunities([campaign], { referenceDate: REF });
      expect(result.suggestions[0].confidence).toBe('high');
      expect(result.suggestions[0].metrics.recent.activeDays).toBe(4);
      expect(result.suggestions[0].metrics.baseline.activeDays).toBe(4);
    });

    it('marks confidence medium when active days are >=2 but below the high threshold', () => {
      const campaign = makeWindowedCampaign({
        recent: { spend: 100, revenue: 1000, conversions: 50 },
        baseline: { spend: 100, revenue: 300, conversions: 40 },
        recentActiveDays: 2,
        baselineActiveDays: 2,
      });
      const result = computeBudgetOpportunities([campaign], { referenceDate: REF });
      expect(result.suggestions[0].confidence).toBe('medium');
    });

    it('marks confidence low when a window has only a single active day', () => {
      const campaign = makeWindowedCampaign({
        recent: { spend: 100, revenue: 1000, conversions: 50 },
        baseline: { spend: 100, revenue: 300, conversions: 40 },
        recentActiveDays: 1,
        baselineActiveDays: 4,
      });
      const result = computeBudgetOpportunities([campaign], { referenceDate: REF });
      expect(result.suggestions[0].confidence).toBe('low');
      expect(result.suggestions[0].metrics.recent.activeDays).toBe(1);
    });
  });

  describe('ordering across multiple campaigns', () => {
    it('orders suggestions by kind priority (reduce < review < scale_test < scale_up)', () => {
      const scaleUp = makeWindowedCampaign({
        id: 'up',
        name: 'Up',
        recent: { spend: 100, revenue: 1000, conversions: 50 },
        baseline: { spend: 100, revenue: 300, conversions: 40 },
      });
      const reduce = makeWindowedCampaign({
        id: 'down',
        name: 'Down',
        recent: { spend: 100, revenue: 100, conversions: 5 },
        baseline: { spend: 100, revenue: 500, conversions: 20 },
      });
      const review = makeWindowedCampaign({
        id: 'rev',
        name: 'Rev',
        recent: { spend: 100, revenue: 400, conversions: 10 },
        baseline: { spend: 100, revenue: 0, conversions: 0 },
      });

      const result = computeBudgetOpportunities([scaleUp, reduce, review], { referenceDate: REF });
      const kinds = result.suggestions.map((s) => s.kind);
      expect(kinds).toEqual<BudgetSuggestionKind[]>(['reduce', 'review', 'scale_up']);
    });

    it('breaks kind ties by confidence (high before low)', () => {
      const highConf = makeWindowedCampaign({
        id: 'hi',
        name: 'High',
        recent: { spend: 100, revenue: 100, conversions: 5 },
        baseline: { spend: 100, revenue: 500, conversions: 20 },
        recentActiveDays: 4,
        baselineActiveDays: 4,
      });
      const lowConf = makeWindowedCampaign({
        id: 'lo',
        name: 'Low',
        recent: { spend: 100, revenue: 100, conversions: 5 },
        baseline: { spend: 100, revenue: 500, conversions: 20 },
        recentActiveDays: 1,
        baselineActiveDays: 1,
      });
      // Both classify as reduce; high-confidence one should come first.
      const result = computeBudgetOpportunities([lowConf, highConf], { referenceDate: REF });
      expect(result.suggestions.map((s) => s.campaignId)).toEqual(['hi', 'lo']);
      expect(result.suggestions[0].confidence).toBe('high');
      expect(result.suggestions[1].confidence).toBe('low');
    });
  });

  describe('suggestion shape & meta', () => {
    it('builds a stable id, a localized title, and carries campaign identity', () => {
      const campaign = makeWindowedCampaign({
        id: 'abc',
        name: 'Brand Search',
        channel: 'Google Ads',
        recent: { spend: 100, revenue: 1000, conversions: 50 },
        baseline: { spend: 100, revenue: 300, conversions: 40 },
      });
      const result = computeBudgetOpportunities([campaign], { referenceDate: REF });
      const s = result.suggestions[0];
      expect(s.id).toBe('camp-abc-scale_up');
      expect(s.campaignId).toBe('abc');
      expect(s.campaignName).toBe('Brand Search');
      expect(s.channel).toBe('Google Ads');
      // Greek title includes the campaign name.
      expect(s.title).toContain('Brand Search');
      expect(s.rationale.length).toBeGreaterThan(0);
      expect(s.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // recent window dates reflect the configured reference date.
      expect(s.metrics.recent.startDate).toBe('2026-01-25');
      expect(s.metrics.recent.endDate).toBe('2026-01-31');
      expect(s.metrics.baseline.startDate).toBe('2026-01-18');
      expect(s.metrics.baseline.endDate).toBe('2026-01-24');
    });

    it('reports meta counts and (without rollups) zero channels analyzed', () => {
      const withDm = makeWindowedCampaign({
        id: 'has',
        recent: { spend: 100, revenue: 1000, conversions: 50 },
        baseline: { spend: 100, revenue: 300, conversions: 40 },
      });
      const noDm = makeCampaign({ id: 'none' });
      const result = computeBudgetOpportunities([withDm, noDm], { referenceDate: REF });
      expect(result.meta.recentDays).toBe(7);
      expect(result.meta.baselineDays).toBe(7);
      expect(result.meta.campaignsWithDailyMetrics).toBe(1);
      expect(result.meta.campaignsSkippedNoDaily).toBe(1);
      // includeChannelRollups defaults to false -> channelsAnalyzed is 0.
      expect(result.meta.channelsAnalyzed).toBe(0);
    });
  });

  describe('channel rollups', () => {
    it('adds channel-scoped suggestions and counts channels when rollups are enabled', () => {
      // Two Google Ads campaigns that individually each scale_up; their merged
      // channel window should also scale_up, producing an extra channel suggestion.
      const c1 = makeWindowedCampaign({
        id: 'g1',
        name: 'G1',
        channel: 'Google Ads',
        recent: { spend: 100, revenue: 1000, conversions: 50 },
        baseline: { spend: 100, revenue: 300, conversions: 40 },
      });
      const c2 = makeWindowedCampaign({
        id: 'g2',
        name: 'G2',
        channel: 'Google Ads',
        recent: { spend: 100, revenue: 1000, conversions: 50 },
        baseline: { spend: 100, revenue: 300, conversions: 40 },
      });

      const result = computeBudgetOpportunities([c1, c2], {
        referenceDate: REF,
        includeChannelRollups: true,
      });

      const channelSuggestions = result.suggestions.filter((s) => s.scope === 'channel');
      expect(channelSuggestions).toHaveLength(1);
      const ch = channelSuggestions[0];
      expect(ch.id).toBe('ch-Google_Ads-scale_up');
      expect(ch.channel).toBe('Google Ads');
      expect(ch.campaignId).toBeUndefined();
      // merged window doubles the per-campaign spend/revenue but keeps the same ROAS.
      expect(ch.metrics.recent.spend).toBeCloseTo(200);
      expect(ch.metrics.recent.roas).toBeCloseTo(10);
      // rationale notes the channel rollup in Greek.
      expect(ch.rationale).toContain('Google Ads');
      expect(result.meta.channelsAnalyzed).toBe(1);
    });

    it('does not emit channel suggestions when rollups are disabled (default)', () => {
      const c1 = makeWindowedCampaign({
        id: 'g1',
        channel: 'Google Ads',
        recent: { spend: 100, revenue: 1000, conversions: 50 },
        baseline: { spend: 100, revenue: 300, conversions: 40 },
      });
      const result = computeBudgetOpportunities([c1], { referenceDate: REF });
      expect(result.suggestions.every((s) => s.scope === 'campaign')).toBe(true);
    });
  });

  describe('custom window sizing', () => {
    it('respects custom recentDays/baselineDays in meta and window bounds', () => {
      // recentDays=3 -> recent = 2026-01-29 .. 2026-01-31 ; baselineDays=3 -> baseline = 2026-01-26 .. 2026-01-28.
      const campaign = makeCampaign({
        id: 'c-custom',
        dailyMetrics: {
          '2026-01-30': makeCampaignDaily({ amount_spent: 100, conversion_value: 1000, conversions: 50 }),
          '2026-01-27': makeCampaignDaily({ amount_spent: 100, conversion_value: 300, conversions: 40 }),
        },
      });
      const result = computeBudgetOpportunities([campaign], {
        referenceDate: REF,
        recentDays: 3,
        baselineDays: 3,
      });
      expect(result.meta.recentDays).toBe(3);
      expect(result.meta.baselineDays).toBe(3);
      expect(result.suggestions).toHaveLength(1);
      const s = result.suggestions[0];
      expect(s.metrics.recent.startDate).toBe('2026-01-29');
      expect(s.metrics.recent.endDate).toBe('2026-01-31');
      expect(s.metrics.baseline.startDate).toBe('2026-01-26');
      expect(s.metrics.baseline.endDate).toBe('2026-01-28');
      expect(s.kind).toBe<BudgetSuggestionKind>('scale_up');
    });
  });
});
