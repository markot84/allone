import type { RFMSegment, BehavioralProfile, PredictiveMetrics } from '../types';

const SEGMENT_BEHAVIORAL_MAP: Record<string, Partial<BehavioralProfile>> = {
  champions: {
    purchase_frequency: 'weekly',
    avg_basket_size: 185,
    device_preference: 'mixed',
    upsell_score: 92,
    cross_sell_score: 88,
    price_sensitivity: 'low',
    engagement_score: 95,
    persona: 'Power Buyer',
    lifecycle_stage: 'loyal',
    preferred_channels: ['Email', 'App Push', 'Loyalty Programs'],
    peak_days: ['Δευτέρα', 'Πέμπτη'],
    peak_hours: ['10:00-12:00', '20:00-22:00'],
    payment_method: 'Κάρτα / Digital Wallet',
  },
  loyal: {
    purchase_frequency: 'monthly',
    avg_basket_size: 120,
    device_preference: 'desktop',
    upsell_score: 75,
    cross_sell_score: 70,
    price_sensitivity: 'medium',
    engagement_score: 78,
    persona: 'Consistent Shopper',
    lifecycle_stage: 'active',
    preferred_channels: ['Email', 'Remarketing', 'Social'],
    peak_days: ['Τρίτη', 'Σάββατο'],
    peak_hours: ['11:00-13:00', '18:00-20:00'],
    payment_method: 'Κάρτα',
  },
  loyal_customers: {
    purchase_frequency: 'monthly',
    avg_basket_size: 120,
    device_preference: 'desktop',
    upsell_score: 75,
    cross_sell_score: 70,
    price_sensitivity: 'medium',
    engagement_score: 78,
    persona: 'Consistent Shopper',
    lifecycle_stage: 'active',
    preferred_channels: ['Email', 'Remarketing', 'Social'],
    peak_days: ['Τρίτη', 'Σάββατο'],
    peak_hours: ['11:00-13:00', '18:00-20:00'],
    payment_method: 'Κάρτα',
  },
  potential: {
    purchase_frequency: 'monthly',
    avg_basket_size: 75,
    device_preference: 'mobile',
    upsell_score: 60,
    cross_sell_score: 65,
    price_sensitivity: 'medium',
    engagement_score: 62,
    persona: 'Emerging Buyer',
    lifecycle_stage: 'new',
    preferred_channels: ['Meta Ads', 'Google Shopping', 'Email'],
    peak_days: ['Παρασκευή', 'Κυριακή'],
    peak_hours: ['12:00-14:00', '21:00-23:00'],
    payment_method: 'Αντικαταβολή / Κάρτα',
  },
  potential_loyalists: {
    purchase_frequency: 'monthly',
    avg_basket_size: 75,
    device_preference: 'mobile',
    upsell_score: 60,
    cross_sell_score: 65,
    price_sensitivity: 'medium',
    engagement_score: 62,
    persona: 'Emerging Buyer',
    lifecycle_stage: 'new',
    preferred_channels: ['Meta Ads', 'Google Shopping', 'Email'],
    peak_days: ['Παρασκευή', 'Κυριακή'],
    peak_hours: ['12:00-14:00', '21:00-23:00'],
    payment_method: 'Αντικαταβολή / Κάρτα',
  },
  at_risk: {
    purchase_frequency: 'quarterly',
    avg_basket_size: 55,
    device_preference: 'mobile',
    upsell_score: 30,
    cross_sell_score: 35,
    price_sensitivity: 'high',
    engagement_score: 28,
    persona: 'Fading Customer',
    lifecycle_stage: 'declining',
    preferred_channels: ['SMS', 'Remarketing', 'Email Win-back'],
    peak_days: ['Σάββατο'],
    peak_hours: ['19:00-21:00'],
    payment_method: 'Αντικαταβολή',
  },
  hibernating: {
    purchase_frequency: 'rare',
    avg_basket_size: 40,
    device_preference: 'mobile',
    upsell_score: 15,
    cross_sell_score: 20,
    price_sensitivity: 'high',
    engagement_score: 12,
    persona: 'Dormant',
    lifecycle_stage: 'dormant',
    preferred_channels: ['Remarketing', 'Display'],
    peak_days: [],
    peak_hours: [],
    payment_method: 'Αντικαταβολή',
  },
  lost: {
    purchase_frequency: 'rare',
    avg_basket_size: 35,
    device_preference: 'mobile',
    upsell_score: 5,
    cross_sell_score: 10,
    price_sensitivity: 'high',
    engagement_score: 5,
    persona: 'Lost Customer',
    lifecycle_stage: 'dormant',
    preferred_channels: ['Remarketing', 'Display', 'Email (Low frequency)'],
    peak_days: [],
    peak_hours: [],
    payment_method: 'Αντικαταβολή',
  },
  new_customers: {
    purchase_frequency: 'monthly',
    avg_basket_size: 65,
    device_preference: 'mobile',
    upsell_score: 50,
    cross_sell_score: 55,
    price_sensitivity: 'medium',
    engagement_score: 55,
    persona: 'First-Timer',
    lifecycle_stage: 'new',
    preferred_channels: ['Google Ads', 'Meta Ads', 'Email Welcome'],
    peak_days: ['Δευτέρα', 'Τετάρτη'],
    peak_hours: ['13:00-15:00'],
    payment_method: 'Κάρτα',
  },
  recent_customers: {
    purchase_frequency: 'monthly',
    avg_basket_size: 70,
    device_preference: 'mobile',
    upsell_score: 55,
    cross_sell_score: 50,
    price_sensitivity: 'medium',
    engagement_score: 58,
    persona: 'Recent Buyer',
    lifecycle_stage: 'new',
    preferred_channels: ['Email', 'Remarketing', 'Social'],
    peak_days: ['Τρίτη', 'Πέμπτη'],
    peak_hours: ['11:00-13:00'],
    payment_method: 'Κάρτα',
  },
  cant_lose_them: {
    purchase_frequency: 'quarterly',
    avg_basket_size: 145,
    device_preference: 'desktop',
    upsell_score: 40,
    cross_sell_score: 45,
    price_sensitivity: 'low',
    engagement_score: 35,
    persona: 'High-Value at Risk',
    lifecycle_stage: 'declining',
    preferred_channels: ['Email VIP', 'Phone', 'Personal Offer'],
    peak_days: ['Δευτέρα'],
    peak_hours: ['09:00-11:00'],
    payment_method: 'Κάρτα',
  },
  customers_needing_attention: {
    purchase_frequency: 'quarterly',
    avg_basket_size: 85,
    device_preference: 'mixed',
    upsell_score: 45,
    cross_sell_score: 50,
    price_sensitivity: 'medium',
    engagement_score: 42,
    persona: 'Needs Nurturing',
    lifecycle_stage: 'declining',
    preferred_channels: ['Email', 'SMS', 'Remarketing'],
    peak_days: ['Τετάρτη', 'Σάββατο'],
    peak_hours: ['17:00-19:00'],
    payment_method: 'Κάρτα / Αντικαταβολή',
  },
};

function getDefaultBehavioral(): BehavioralProfile {
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
    persona: 'General',
    lifecycle_stage: 'active',
    communication_preferences: [],
  };
}

/** Normalize a key for SEGMENT_BEHAVIORAL_MAP (Can't -> Cant, trim, spaces). */
export function normalizeSegmentLookupKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_').replace(/'/g, '');
}

function getMappedBehavioralPartial(segment: RFMSegment): Partial<BehavioralProfile> {
  const byName = normalizeSegmentLookupKey(segment.name);
  return (
    SEGMENT_BEHAVIORAL_MAP[segment.id] ||
    SEGMENT_BEHAVIORAL_MAP[normalizeSegmentLookupKey(segment.id)] ||
    SEGMENT_BEHAVIORAL_MAP[byName] ||
    {}
  );
}

/** Values set by validateSegmentRow when columns are missing - not a "real" import. */
const IMPORT_TEMPLATE_DEFAULTS = {
  engagement_score: 40,
  upsell_score: 30,
  cross_sell_score: 30,
  avg_basket_size: 60,
} as const;

function buildProfileFromMapped(mapped: Partial<BehavioralProfile>): BehavioralProfile {
  const base = getDefaultBehavioral();
  const profile: BehavioralProfile = {
    ...base,
    ...mapped,
    category_affinity: mapped.category_affinity || base.category_affinity,
    communication_preferences: (mapped.preferred_channels || base.preferred_channels).map((ch) => ({
      channel: ch,
      frequency:
        mapped.lifecycle_stage === 'loyal' || mapped.lifecycle_stage === 'active'
          ? 'Εβδομαδιαία'
          : 'Μηνιαία',
      best_time: (mapped.peak_hours || base.peak_hours)[0] || '10:00-12:00',
    })),
  };
  return profile;
}

/** Merge imported behavioral with RFM-derived: when the CSV had only persona etc. and scores
 * are the template defaults (40/30/30/60), use the per-segment map values instead. */
function mergeImportedBehavioralWithDerived(
  imported: BehavioralProfile,
  derived: BehavioralProfile
): BehavioralProfile {
  const out: BehavioralProfile = { ...derived, ...imported };
  if (
    imported.engagement_score === IMPORT_TEMPLATE_DEFAULTS.engagement_score &&
    derived.engagement_score !== imported.engagement_score
  ) {
    out.engagement_score = derived.engagement_score;
  }
  if (
    imported.upsell_score === IMPORT_TEMPLATE_DEFAULTS.upsell_score &&
    derived.upsell_score !== imported.upsell_score
  ) {
    out.upsell_score = derived.upsell_score;
  }
  if (
    imported.cross_sell_score === IMPORT_TEMPLATE_DEFAULTS.cross_sell_score &&
    derived.cross_sell_score !== imported.cross_sell_score
  ) {
    out.cross_sell_score = derived.cross_sell_score;
  }
  if (
    imported.avg_basket_size === IMPORT_TEMPLATE_DEFAULTS.avg_basket_size &&
    derived.avg_basket_size !== imported.avg_basket_size
  ) {
    out.avg_basket_size = derived.avg_basket_size;
  }
  const onlyEmail =
    imported.preferred_channels?.length === 1 && imported.preferred_channels[0] === 'Email';
  if (onlyEmail && derived.preferred_channels && derived.preferred_channels.length > 1) {
    out.preferred_channels = derived.preferred_channels;
    out.communication_preferences = derived.communication_preferences;
  }
  return out;
}

export function deriveBehavioralProfile(segment: RFMSegment): BehavioralProfile {
  const mapped = getMappedBehavioralPartial(segment);
  const derived = buildProfileFromMapped(mapped);

  if (!segment.behavioral) return derived;

  return mergeImportedBehavioralWithDerived(segment.behavioral, derived);
}

/** Compute predictive metrics from the merged behavioral profile, not just the raw map. */
function computeDerivedPredictiveMetrics(segment: RFMSegment): PredictiveMetrics {
  const profile = deriveBehavioralProfile(segment);
  const avgBasket = profile.avg_basket_size;
  const engagement = profile.engagement_score;
  const freq = profile.purchase_frequency;

  const freqMultiplier: Record<string, number> = {
    daily: 300, weekly: 52, monthly: 12, quarterly: 4, rare: 1,
  };
  const yearlyOrders = freqMultiplier[freq] || 12;
  const estimatedLtv = avgBasket * yearlyOrders * 2.5;

  const churnRisk = Math.max(0, Math.min(100, 100 - engagement));
  const churnLabel: PredictiveMetrics['churn_risk_label'] =
    churnRisk < 20 ? 'low' : churnRisk < 50 ? 'medium' : churnRisk < 75 ? 'high' : 'critical';

  const nextPurchaseProb = Math.max(5, Math.min(99, engagement * 1.05));
  const daysToNext = freq === 'daily' ? 1 : freq === 'weekly' ? 7 : freq === 'monthly' ? 30 : freq === 'quarterly' ? 90 : 180;

  const demandTrend: PredictiveMetrics['demand_trend'] =
    engagement > 70 ? 'growing' : engagement > 40 ? 'stable' : 'declining';

  return {
    estimated_ltv: Math.round(estimatedLtv),
    ltv_confidence: Math.min(95, 50 + engagement * 0.4),
    churn_risk: Math.round(churnRisk),
    churn_risk_label: churnLabel,
    next_purchase_probability: Math.round(nextPurchaseProb),
    days_to_next_purchase: daysToNext,
    predicted_next_order_value: Math.round(avgBasket * 1.05),
    revenue_forecast_30d: Math.round(segment.count * avgBasket * (30 / daysToNext) * (engagement / 100) * 0.3),
    revenue_forecast_90d: Math.round(segment.count * avgBasket * (90 / daysToNext) * (engagement / 100) * 0.3),
    demand_trend: demandTrend,
    retention_score: Math.round(Math.max(5, engagement * 0.95)),
  };
}

export function derivePredictiveMetrics(segment: RFMSegment): PredictiveMetrics {
  const derived = computeDerivedPredictiveMetrics(segment);
  const imp = segment.predictive;
  if (!imp) return derived;

  const templateChurn = Math.round(100 - IMPORT_TEMPLATE_DEFAULTS.engagement_score);
  /** Value produced by empty CSV fields (same 60% churn everywhere = 100 - default engagement 40). */
  const useImportedChurn = imp.churn_risk > 0 && imp.churn_risk !== templateChurn;
  const useImportedLtv = imp.estimated_ltv > 0;

  return {
    ...derived,
    ...imp,
    estimated_ltv: useImportedLtv ? imp.estimated_ltv : derived.estimated_ltv,
    ltv_confidence: useImportedLtv ? imp.ltv_confidence : derived.ltv_confidence,
    churn_risk: useImportedChurn ? imp.churn_risk : derived.churn_risk,
    churn_risk_label: useImportedChurn ? imp.churn_risk_label : derived.churn_risk_label,
    next_purchase_probability: useImportedLtv ? imp.next_purchase_probability : derived.next_purchase_probability,
    days_to_next_purchase: imp.days_to_next_purchase > 0 ? imp.days_to_next_purchase : derived.days_to_next_purchase,
    predicted_next_order_value: useImportedLtv ? imp.predicted_next_order_value : derived.predicted_next_order_value,
    revenue_forecast_30d: imp.revenue_forecast_30d > 0 ? imp.revenue_forecast_30d : derived.revenue_forecast_30d,
    revenue_forecast_90d: imp.revenue_forecast_90d > 0 ? imp.revenue_forecast_90d : derived.revenue_forecast_90d,
    demand_trend: imp.demand_trend && useImportedLtv ? imp.demand_trend : derived.demand_trend,
    retention_score: useImportedChurn ? imp.retention_score : derived.retention_score,
  };
}

export function enrichSegmentsWithAnalytics(segments: RFMSegment[]): RFMSegment[] {
  return segments.map(seg => ({
    ...seg,
    behavioral: deriveBehavioralProfile(seg),
    predictive: derivePredictiveMetrics(seg),
  }));
}
