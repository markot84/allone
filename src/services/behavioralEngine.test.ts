/** Unit tests for behavioralEngine: pure logic producing behavioral/predictive
 * profiles per RFM segment (normalize, derive, merge imported, enrich). */
import { describe, expect, it } from 'vitest';
import type { BehavioralProfile, PredictiveMetrics, RFMSegment } from '../types';
import {
  deriveBehavioralProfile,
  derivePredictiveMetrics,
  enrichSegmentsWithAnalytics,
  normalizeSegmentLookupKey,
} from './behavioralEngine';

/** Minimal-but-valid RFMSegment; tests declare only the fields they care about. */
function makeSegment(overrides: Partial<RFMSegment> = {}): RFMSegment {
  return {
    id: 'champions',
    name: 'Champions',
    rfm_score: '555',
    count: 100,
    percentage: 10,
    revenue_share: 25,
    color: '#000',
    description: 'desc',
    icon: 'star',
    ...overrides,
  };
}

/** A full behavioral profile to push in as "imported". */
function makeBehavioral(overrides: Partial<BehavioralProfile> = {}): BehavioralProfile {
  return {
    preferred_channels: ['Email'],
    purchase_frequency: 'monthly',
    avg_basket_size: 60,
    peak_hours: [],
    peak_days: [],
    payment_method: 'Κάρτα',
    device_preference: 'mobile',
    category_affinity: [],
    upsell_score: 30,
    cross_sell_score: 30,
    price_sensitivity: 'medium',
    engagement_score: 40,
    persona: 'Imported Persona',
    lifecycle_stage: 'active',
    communication_preferences: [],
    ...overrides,
  };
}

/** A full predictive metrics object to push in as "imported". */
function makePredictive(overrides: Partial<PredictiveMetrics> = {}): PredictiveMetrics {
  return {
    estimated_ltv: 0,
    ltv_confidence: 0,
    churn_risk: 0,
    churn_risk_label: 'low',
    next_purchase_probability: 0,
    days_to_next_purchase: 0,
    predicted_next_order_value: 0,
    revenue_forecast_30d: 0,
    revenue_forecast_90d: 0,
    demand_trend: 'stable',
    retention_score: 0,
    ...overrides,
  };
}

describe('normalizeSegmentLookupKey', () => {
  it('lowercases, trims, replaces spaces with _, strips apostrophe', () => {
    expect(normalizeSegmentLookupKey("Can't Lose Them")).toBe('cant_lose_them');
  });

  it('collapses multiple spaces into a single _', () => {
    expect(normalizeSegmentLookupKey('  At   Risk  ')).toBe('at_risk');
  });

  it('leaves an already-normalized key as is', () => {
    expect(normalizeSegmentLookupKey('hibernating')).toBe('hibernating');
  });
});

describe('deriveBehavioralProfile', () => {
  describe('lookup of mapped values per segment', () => {
    it('finds the map directly from segment.id', () => {
      const profile = deriveBehavioralProfile(makeSegment({ id: 'champions' }));
      expect(profile.persona).toBe('Power Buyer');
      expect(profile.avg_basket_size).toBe(185);
      expect(profile.engagement_score).toBe(95);
      expect(profile.purchase_frequency).toBe('weekly');
      expect(profile.lifecycle_stage).toBe('loyal');
    });

    it('finds the map via normalized id when the raw id has uppercase/spaces', () => {
      const profile = deriveBehavioralProfile(
        makeSegment({ id: "Can't Lose Them", name: 'Whatever' }),
      );
      expect(profile.persona).toBe('High-Value at Risk');
      expect(profile.avg_basket_size).toBe(145);
    });

    it('falls back to lookup via normalized name when the id does not match', () => {
      const profile = deriveBehavioralProfile(
        makeSegment({ id: 'unknown-id-123', name: 'At Risk' }),
      );
      expect(profile.persona).toBe('Fading Customer');
      expect(profile.lifecycle_stage).toBe('declining');
      expect(profile.price_sensitivity).toBe('high');
    });

    it('returns the generic default profile when there is no match', () => {
      const profile = deriveBehavioralProfile(
        makeSegment({ id: 'no-such-segment', name: 'Nothing Here' }),
      );
      expect(profile.persona).toBe('General');
      expect(profile.avg_basket_size).toBe(60);
      expect(profile.engagement_score).toBe(40);
      expect(profile.preferred_channels).toEqual(['Email']);
      expect(profile.lifecycle_stage).toBe('active');
    });
  });

  describe('communication_preferences (derived from preferred_channels)', () => {
    it('builds one preference per channel with best_time set to the first peak hour', () => {
      const profile = deriveBehavioralProfile(makeSegment({ id: 'champions' }));
      // champions: preferred_channels = ['Email','App Push','Loyalty Programs'], peak_hours[0]='10:00-12:00'
      expect(profile.communication_preferences).toHaveLength(3);
      expect(profile.communication_preferences[0]).toEqual({
        channel: 'Email',
        frequency: 'Εβδομαδιαία', // lifecycle_stage 'loyal' → weekly
        best_time: '10:00-12:00',
      });
    });

    it('uses Monthly frequency for lifecycle_stage other than loyal/active', () => {
      // hibernating → lifecycle 'dormant', peak_hours [] → best_time fallback '10:00-12:00'
      const profile = deriveBehavioralProfile(makeSegment({ id: 'hibernating' }));
      expect(profile.communication_preferences[0].frequency).toBe('Μηνιαία');
      expect(profile.communication_preferences[0].best_time).toBe('10:00-12:00');
    });

    it('uses Weekly for lifecycle_stage active too', () => {
      // loyal segment → lifecycle 'active'
      const profile = deriveBehavioralProfile(makeSegment({ id: 'loyal' }));
      expect(profile.communication_preferences[0].frequency).toBe('Εβδομαδιαία');
    });
  });

  describe('merge of imported behavioral with derived', () => {
    it('without imported behavioral returns the purely derived profile', () => {
      const profile = deriveBehavioralProfile(makeSegment({ id: 'champions', behavioral: undefined }));
      expect(profile.engagement_score).toBe(95);
      expect(profile.persona).toBe('Power Buyer');
    });

    it('replaces template-default scores with the derived ones (CSV had only persona)', () => {
      // imported scores equal to IMPORT_TEMPLATE_DEFAULTS (40/30/30/60) → fall back to derived
      const imported = makeBehavioral({
        persona: 'CSV Persona',
        engagement_score: 40,
        upsell_score: 30,
        cross_sell_score: 30,
        avg_basket_size: 60,
        preferred_channels: ['Email'],
      });
      const profile = deriveBehavioralProfile(makeSegment({ id: 'champions', behavioral: imported }));
      // persona from the import is kept...
      expect(profile.persona).toBe('CSV Persona');
      // ...but template-default scores are replaced by the champions-derived ones
      expect(profile.engagement_score).toBe(95);
      expect(profile.upsell_score).toBe(92);
      expect(profile.cross_sell_score).toBe(88);
      expect(profile.avg_basket_size).toBe(185);
      // Email-only channels → replaced by the richer derived channels
      expect(profile.preferred_channels).toEqual(['Email', 'App Push', 'Loyalty Programs']);
      expect(profile.communication_preferences).toHaveLength(3);
    });

    it('keeps non-default imported scores (real import, not template)', () => {
      const imported = makeBehavioral({
        persona: 'Real Import',
        engagement_score: 77,
        upsell_score: 66,
        cross_sell_score: 55,
        avg_basket_size: 222,
        preferred_channels: ['SMS', 'Push'],
      });
      const profile = deriveBehavioralProfile(makeSegment({ id: 'champions', behavioral: imported }));
      expect(profile.engagement_score).toBe(77);
      expect(profile.upsell_score).toBe(66);
      expect(profile.cross_sell_score).toBe(55);
      expect(profile.avg_basket_size).toBe(222);
      // more than one channel (or ≠ Email-only) → not replaced
      expect(profile.preferred_channels).toEqual(['SMS', 'Push']);
    });

    it('does not replace Email-only channels if the derived set is not richer', () => {
      // default (unmatched) segment: derived.preferred_channels = ['Email'] (length 1)
      const imported = makeBehavioral({ preferred_channels: ['Email'] });
      const profile = deriveBehavioralProfile(
        makeSegment({ id: 'no-match', name: 'no-match', behavioral: imported }),
      );
      expect(profile.preferred_channels).toEqual(['Email']);
    });
  });
});

describe('derivePredictiveMetrics', () => {
  describe('deterministic computation without imported predictive', () => {
    it('computes LTV/churn/forecast for champions (weekly, engagement 95)', () => {
      const seg = makeSegment({ id: 'champions', count: 100 });
      const m = derivePredictiveMetrics(seg);
      // estimatedLtv = avgBasket(185) * yearlyOrders(weekly=52) * 2.5 = 24050
      expect(m.estimated_ltv).toBe(24050);
      // ltv_confidence = min(95, 50 + 95*0.4=88) = 88
      expect(m.ltv_confidence).toBe(88);
      // churnRisk = 100 - 95 = 5 → 'low'
      expect(m.churn_risk).toBe(5);
      expect(m.churn_risk_label).toBe('low');
      // nextPurchaseProb = min(99, 95*1.05=99.75) = 99
      expect(m.next_purchase_probability).toBe(99);
      // daysToNext weekly = 7
      expect(m.days_to_next_purchase).toBe(7);
      // predicted_next_order_value = round(185*1.05) = 194
      expect(m.predicted_next_order_value).toBe(194);
      // engagement 95 > 70 → 'growing'
      expect(m.demand_trend).toBe('growing');
      // retention = round(max(5, 95*0.95=90.25)) = 90
      expect(m.retention_score).toBe(90);
    });

    it('computes revenue forecasts based on count/avgBasket/engagement/daysToNext', () => {
      const seg = makeSegment({ id: 'champions', count: 100 });
      const m = derivePredictiveMetrics(seg);
      // 30d = round(count*avgBasket*(30/daysToNext)*(engagement/100)*0.3)
      //      = round(100*185*(30/7)*(95/100)*0.3) = round(100*185*4.2857*0.95*0.3)
      const expected30 = Math.round(100 * 185 * (30 / 7) * (95 / 100) * 0.3);
      const expected90 = Math.round(100 * 185 * (90 / 7) * (95 / 100) * 0.3);
      expect(m.revenue_forecast_30d).toBe(expected30);
      expect(m.revenue_forecast_90d).toBe(expected90);
    });

    it('produces high/critical churn labels for low engagement (hibernating/lost)', () => {
      // hibernating: engagement 12 → churn 88 → 'critical', rare freq → days 180
      const hib = derivePredictiveMetrics(makeSegment({ id: 'hibernating' }));
      expect(hib.churn_risk).toBe(88);
      expect(hib.churn_risk_label).toBe('critical');
      expect(hib.days_to_next_purchase).toBe(180);
      expect(hib.demand_trend).toBe('declining');
      // next_purchase_probability has a floor of 5
      expect(hib.next_purchase_probability).toBe(13); // round(12*1.05=12.6)=13
    });

    it('produces medium churn and stable trend for mid-range engagement', () => {
      // customers_needing_attention: engagement 42 → churn 58 → 'high'? 58<75 → 'high'
      // demand: 42>40 → 'stable'
      const m = derivePredictiveMetrics(makeSegment({ id: 'customers_needing_attention' }));
      expect(m.churn_risk).toBe(58);
      expect(m.churn_risk_label).toBe('high');
      expect(m.demand_trend).toBe('stable');
    });

    it('applies the floor of 5 to next_purchase_probability for lost (engagement 5)', () => {
      // lost: engagement 5 → 5*1.05=5.25 → max(5,...) → round 5
      const m = derivePredictiveMetrics(makeSegment({ id: 'lost' }));
      expect(m.next_purchase_probability).toBe(5);
      expect(m.retention_score).toBe(5); // max(5, 5*0.95=4.75) → 5
    });
  });

  describe('merge with imported predictive', () => {
    it('without imported predictive returns the derived values', () => {
      const m = derivePredictiveMetrics(makeSegment({ id: 'champions', predictive: undefined }));
      expect(m.estimated_ltv).toBe(24050);
    });

    it('ignores template-default churn (60%) and keeps the derived churn', () => {
      // templateChurn = 100 - 40 = 60. imported churn 60 → useImportedChurn false
      const imported = makePredictive({
        churn_risk: 60,
        churn_risk_label: 'high',
        retention_score: 99,
      });
      const m = derivePredictiveMetrics(makeSegment({ id: 'champions', predictive: imported }));
      // derived champions churn = 5
      expect(m.churn_risk).toBe(5);
      expect(m.churn_risk_label).toBe('low');
      expect(m.retention_score).toBe(90); // derived, not the imported 99
    });

    it('keeps imported churn when it is not the template default', () => {
      const imported = makePredictive({
        churn_risk: 42,
        churn_risk_label: 'medium',
        retention_score: 71,
      });
      const m = derivePredictiveMetrics(makeSegment({ id: 'champions', predictive: imported }));
      expect(m.churn_risk).toBe(42);
      expect(m.churn_risk_label).toBe('medium');
      expect(m.retention_score).toBe(71);
    });

    it('ignores zero imported LTV and keeps the derived', () => {
      // estimated_ltv 0 → useImportedLtv false
      const imported = makePredictive({ estimated_ltv: 0, ltv_confidence: 12 });
      const m = derivePredictiveMetrics(makeSegment({ id: 'champions', predictive: imported }));
      expect(m.estimated_ltv).toBe(24050);
      expect(m.ltv_confidence).toBe(88); // derived, not the imported 12
    });

    it('keeps positive imported LTV and its linked fields', () => {
      const imported = makePredictive({
        estimated_ltv: 5000,
        ltv_confidence: 70,
        next_purchase_probability: 44,
        predicted_next_order_value: 88,
      });
      const m = derivePredictiveMetrics(makeSegment({ id: 'champions', predictive: imported }));
      expect(m.estimated_ltv).toBe(5000);
      expect(m.ltv_confidence).toBe(70);
      expect(m.next_purchase_probability).toBe(44);
      expect(m.predicted_next_order_value).toBe(88);
    });

    it('keeps positive imported days/forecasts but falls back to derived when 0', () => {
      const imported = makePredictive({
        days_to_next_purchase: 14,
        revenue_forecast_30d: 1234,
        revenue_forecast_90d: 0, // → falls back to derived
      });
      const seg = makeSegment({ id: 'champions', count: 100 });
      const m = derivePredictiveMetrics(makeSegment({ ...seg, predictive: imported }));
      const derivedNoImport = derivePredictiveMetrics(seg);
      expect(m.days_to_next_purchase).toBe(14);
      expect(m.revenue_forecast_30d).toBe(1234);
      expect(m.revenue_forecast_90d).toBe(derivedNoImport.revenue_forecast_90d);
    });

    it('uses imported demand_trend only when it coexists with a positive LTV', () => {
      // demand_trend exists but LTV 0 → the derived trend is used
      const noLtv = derivePredictiveMetrics(
        makeSegment({ id: 'champions', predictive: makePredictive({ demand_trend: 'declining', estimated_ltv: 0 }) }),
      );
      expect(noLtv.demand_trend).toBe('growing'); // derived champions

      const withLtv = derivePredictiveMetrics(
        makeSegment({ id: 'champions', predictive: makePredictive({ demand_trend: 'declining', estimated_ltv: 9000 }) }),
      );
      expect(withLtv.demand_trend).toBe('declining'); // imported
    });
  });
});

describe('enrichSegmentsWithAnalytics', () => {
  it('enriches each segment with behavioral + predictive while keeping the original fields', () => {
    const segments = [
      makeSegment({ id: 'champions', name: 'Champions', count: 100 }),
      makeSegment({ id: 'lost', name: 'Lost', count: 5 }),
    ];
    const enriched = enrichSegmentsWithAnalytics(segments);

    expect(enriched).toHaveLength(2);
    expect(enriched[0].id).toBe('champions');
    expect(enriched[0].count).toBe(100); // original fields are kept
    expect(enriched[0].behavioral?.persona).toBe('Power Buyer');
    expect(enriched[0].predictive?.estimated_ltv).toBe(24050);

    expect(enriched[1].behavioral?.persona).toBe('Lost Customer');
    expect(enriched[1].predictive?.churn_risk_label).toBe('critical');
  });

  it('does not mutate the original segments (immutable input)', () => {
    const seg = makeSegment({ id: 'champions' });
    enrichSegmentsWithAnalytics([seg]);
    expect(seg.behavioral).toBeUndefined();
    expect(seg.predictive).toBeUndefined();
  });

  it('returns an empty array for empty input', () => {
    expect(enrichSegmentsWithAnalytics([])).toEqual([]);
  });

  it('enriches a single unknown segment with the generic defaults', () => {
    const enriched = enrichSegmentsWithAnalytics([
      makeSegment({ id: 'mystery', name: 'Mystery', count: 1 }),
    ]);
    expect(enriched).toHaveLength(1);
    expect(enriched[0].behavioral?.persona).toBe('General');
    // engagement default 40 → churn 60 → 'high'
    expect(enriched[0].predictive?.churn_risk).toBe(60);
    expect(enriched[0].predictive?.churn_risk_label).toBe('high');
  });
});
