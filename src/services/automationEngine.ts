import type {
  Product, RFMSegment, Campaign, BrandPlan,
  TriggerConfig, AlertSeverity,
} from '../types';
import type { Supplier } from '../types';
import { TRIGGERS_CATALOG } from '../data/triggersCatalog';
import { AutomationSettingsService, AutomationAlertsService } from './automationSettings';
import { DecisionsService, logAndNotify } from './coordination';
import { classifyStockHealth, getDaysOfStock, getProductTod } from '../utils/productUtils';
import { getUpcomingSeason, SEASONAL_PERIODS } from '../data/seasonalPeriods';
import { deriveBehavioralProfile, derivePredictiveMetrics } from './behavioralEngine';

interface EvaluationContext {
  brandId: string;
  userId: string;
  userName: string;
  plan: BrandPlan;
  products: Product[];
  segments: RFMSegment[];
  campaigns: Campaign[];
  suppliers: Supplier[];
  procurementInventory?: Record<string, string | undefined>[];
  procurementCosting?: Record<string, string | undefined>[];
  procurementPricingPolicy?: Record<string, string | undefined>[];
  priceBenchmarks?: { priceDiff: number }[];
  competitorNewAdsCount?: number;
  ga4?: {
    dailyEntries: { date: string; sessions: number; totalUsers: number; newUsers: number; pageViews: number; bounceRate: number; conversions: number }[];
    trafficSources: { channel: string; sessions: number; users: number; conversions: number }[];
    topPages: { path: string; pageViews: number; sessions: number; bounceRate: number }[];
  };
}

interface TriggerResult {
  triggerId: string;
  triggerLabel: string;
  triggerGroup?: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  suggestions: string[];
  data: Record<string, unknown>;
}

function evaluateTrigger(
  triggerId: string,
  config: TriggerConfig,
  ctx: EvaluationContext
): TriggerResult | null {
  const threshold = config.threshold ?? 0;

  switch (triggerId) {
    case 'dead_stock_alert': {
      if (ctx.products.length === 0) return null;
      const supplierTodMap = new Map(ctx.suppliers.map(s => [s.name, s.tod]));
      const deadCount = ctx.products.filter(p => {
        const tod = getProductTod(p, supplierTodMap);
        return classifyStockHealth(p, tod) === 'dead';
      }).length;
      const pct = (deadCount / ctx.products.length) * 100;
      if (pct <= threshold) return null;
      return {
        triggerId,
        triggerLabel: 'Dead Stock',
        severity: pct > 30 ? 'critical' : 'warning',
        title: `Dead stock στο ${pct.toFixed(1)}%`,
        description: `${deadCount} από ${ctx.products.length} SKUs χωρίς πωλήσεις. Εξετάστε εκκαθάριση ή επανατιμολόγηση.`,
        suggestions: ['Δημιουργία flash sale campaign', 'Αναθεώρηση τιμολογιακής πολιτικής', 'Bundling με δημοφιλή προϊόντα'],
        data: { deadCount, totalProducts: ctx.products.length, percentage: pct },
      };
    }

    case 'excess_stock_alert': {
      if (ctx.products.length === 0) return null;
      const supplierTodMap = new Map(ctx.suppliers.map(s => [s.name, s.tod]));
      let excessValue = 0;
      let excessCount = 0;
      for (const p of ctx.products) {
        const tod = getProductTod(p, supplierTodMap);
        if (classifyStockHealth(p, tod) === 'excess') {
          excessValue += (p.price ?? 0) * (p.stock_level ?? 0);
          excessCount++;
        }
      }
      if (excessValue <= threshold) return null;
      return {
        triggerId,
        triggerLabel: 'Excess Stock',
        severity: excessValue > threshold * 2 ? 'critical' : 'warning',
        title: `Excess stock αξίας ${excessValue.toLocaleString('el-GR')}€`,
        description: `${excessCount} SKUs με υπερβολικό απόθεμα. Δεσμεύεται κεφάλαιο χωρίς κίνηση.`,
        suggestions: ['Προωθητική ενέργεια στα excess SKUs', 'Μείωση μελλοντικών παραγγελιών', 'Cross-sell σε marketing campaigns'],
        data: { excessValue, excessCount },
      };
    }

    case 'low_stock_critical': {
      const supplierTodMap = new Map(ctx.suppliers.map(s => [s.name, s.tod]));
      const highMarginLow = ctx.products.filter(p => {
        if (p.margin_tier !== 'high' && (p.margin_percentage ?? 0) <= 25) return false;
        const tod = getProductTod(p, supplierTodMap);
        const dos = getDaysOfStock(p);
        return dos > 0 && dos < tod / 2;
      });
      if (highMarginLow.length < threshold) return null;
      return {
        triggerId,
        triggerLabel: 'Χαμηλό απόθεμα high-margin',
        severity: 'critical',
        title: `${highMarginLow.length} high-margin SKUs σε κρίσιμα χαμηλό απόθεμα`,
        description: 'Προϊόντα υψηλού margin κινδυνεύουν να εξαντληθούν πριν την αναπλήρωση.',
        suggestions: ['Επείγουσα παραγγελία στον προμηθευτή', 'Ρύθμιση stock alerts', 'Εξέταση εναλλακτικών προμηθευτών'],
        data: { count: highMarginLow.length, skus: highMarginLow.slice(0, 5).map(p => p.sku) },
      };
    }

    case 'new_products_imported': {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - threshold);
      const newProducts = ctx.products.filter(p => {
        if (!p.first_available_date) return false;
        return new Date(p.first_available_date) >= cutoff;
      });
      if (newProducts.length === 0) return null;
      return {
        triggerId,
        triggerLabel: 'Νέα προϊόντα',
        severity: 'info',
        title: `${newProducts.length} νέα προϊόντα εισήχθησαν`,
        description: `Τις τελευταίες ${threshold} ημέρες προστέθηκαν νέα SKUs στον κατάλογο.`,
        suggestions: ['Ρύθμιση τιμών και margin', 'Δημιουργία launch campaign', 'Ενημέρωση εσωτερικών τμημάτων'],
        data: { count: newProducts.length },
      };
    }

    case 'stock_growth': {
      const totalStock = ctx.products.reduce((sum, p) => sum + (p.stock_level ?? 0), 0);
      if (totalStock < threshold) return null;
      return {
        triggerId,
        triggerLabel: 'Μεγέθυνση αποθέματος',
        severity: 'info',
        title: `Συνολικό απόθεμα: ${totalStock.toLocaleString('el-GR')} μονάδες`,
        description: 'Το συνολικό stock level ξεπέρασε το κατώφλι. Εξετάστε εμπορική στρατηγική.',
        suggestions: ['Ενεργοποίηση στρατηγικής stock clearance', 'Αξιολόγηση slow movers', 'Σχεδιασμός προωθητικής ενέργειας'],
        data: { totalStock },
      };
    }

    case 'campaign_high_roas': {
      const highPerf = ctx.campaigns.filter(c => c.is_active && (c.roas ?? 0) > threshold);
      if (highPerf.length === 0) return null;
      const ga4Organic = ctx.ga4?.trafficSources.find(s => s.channel === 'Organic Search');
      const ga4CrossNote = ga4Organic
        ? ` GA4: Organic search φέρνει ${ga4Organic.sessions.toLocaleString()} sessions — τα paid campaigns ενισχύουν τα organic.`
        : '';
      return {
        triggerId,
        triggerLabel: 'Υψηλή απόδοση campaign',
        severity: 'info',
        title: `${highPerf.length} campaigns με ROAS > ${threshold}x`,
        description: `Ορισμένα campaigns αποδίδουν εξαιρετικά. Εξετάστε αύξηση budget.${ga4CrossNote}`,
        suggestions: ['Αύξηση budget στα top campaigns', 'Scale σε νέα κοινά', 'Αναπαραγωγή στρατηγικής σε άλλα κανάλια'],
        data: { campaigns: highPerf.slice(0, 3).map(c => ({ name: c.name, roas: c.roas })) },
      };
    }

    case 'campaign_underperform': {
      const under = ctx.campaigns.filter(c => c.is_active && (c.roas ?? 0) < threshold && (c.amount_spent ?? 0) > 50);
      if (under.length === 0) return null;
      return {
        triggerId,
        triggerLabel: 'Campaign σε αδυναμία',
        severity: 'warning',
        title: `${under.length} campaigns με ROAS < ${threshold}x`,
        description: 'Ενεργά campaigns δεν αποδίδουν. Εξετάστε pause ή βελτιστοποίηση.',
        suggestions: ['Pause χαμηλής απόδοσης campaigns', 'A/B test νέων creatives', 'Αλλαγή targeting ή bidding strategy'],
        data: { campaigns: under.slice(0, 3).map(c => ({ name: c.name, roas: c.roas, spent: c.amount_spent })) },
      };
    }

    case 'segment_churn_risk': {
      const atRisk = ctx.segments.find(s => s.id === 'at_risk' || s.name?.toLowerCase().includes('risk'));
      if (!atRisk || (atRisk.percentage ?? 0) <= threshold) return null;
      let ga4Signal = '';
      if (ctx.ga4 && ctx.ga4.dailyEntries.length >= 14) {
        const last7 = ctx.ga4.dailyEntries.slice(-7);
        const prev7 = ctx.ga4.dailyEntries.slice(-14, -7);
        const retLast = last7.reduce((a, d) => a + (d.totalUsers - d.newUsers), 0);
        const retPrev = prev7.reduce((a, d) => a + (d.totalUsers - d.newUsers), 0);
        if (retPrev > 0) {
          const retChange = ((retLast - retPrev) / retPrev) * 100;
          if (retChange < -5) ga4Signal = ` GA4 επιβεβαιώνει: returning users ${retChange.toFixed(0)}%.`;
        }
      }
      return {
        triggerId,
        triggerLabel: 'Churn risk',
        severity: (atRisk.percentage ?? 0) > threshold * 1.5 ? 'critical' : 'warning',
        title: `At-risk segment στο ${atRisk.percentage?.toFixed(1)}%`,
        description: `${atRisk.count} πελάτες κινδυνεύουν να χαθούν. Απαιτείται win-back στρατηγική.${ga4Signal}`,
        suggestions: ['Email win-back campaign', 'Exclusive offers σε at-risk πελάτες', 'Ανάλυση αιτιών αποχώρησης'],
        data: { percentage: atRisk.percentage, count: atRisk.count },
      };
    }

    case 'segment_vip_growth': {
      const vip = ctx.segments.find(s =>
        s.id === 'champions' || s.id === 'vip' ||
        s.name?.toLowerCase().includes('champion') || s.name?.toLowerCase().includes('vip')
      );
      if (!vip || (vip.percentage ?? 0) <= threshold) return null;
      return {
        triggerId,
        triggerLabel: 'VIP ανάπτυξη',
        severity: 'info',
        title: `VIP segment στο ${vip.percentage?.toFixed(1)}%`,
        description: `${vip.count} πελάτες Champions/VIP. Ενισχύστε τη σχέση μαζί τους.`,
        suggestions: ['Loyalty program activation', 'Exclusive previews ή early access', 'Personalized cross-sell offers'],
        data: { percentage: vip.percentage, count: vip.count },
      };
    }

    case 'seasonal_approaching': {
      const upcoming = getUpcomingSeason();
      if (!upcoming) {
        const now = new Date();
        for (const sp of SEASONAL_PERIODS) {
          const startDate = new Date(now.getFullYear(), sp.dateRange.startMonth - 1, sp.dateRange.startDay);
          if (startDate < now) startDate.setFullYear(startDate.getFullYear() + 1);
          const daysUntil = Math.ceil((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (daysUntil <= threshold && daysUntil > 0) {
            return {
              triggerId,
              triggerLabel: 'Εποχική περίοδος',
              severity: daysUntil <= 7 ? 'warning' : 'info',
              title: `${sp.name} σε ${daysUntil} ημέρες`,
              description: `Η εποχική περίοδος "${sp.name}" πλησιάζει. Προετοιμάστε στρατηγική.`,
              suggestions: ['Ενεργοποίηση εποχικής στρατηγικής', 'Προετοιμασία campaigns', 'Έλεγχος αποθέματος'],
              data: { period: sp.name, daysUntil },
            };
          }
        }
        return null;
      }
      return {
        triggerId,
        triggerLabel: 'Εποχική περίοδος',
        severity: 'info',
        title: `Ενεργή εποχική περίοδος: ${upcoming.name}`,
        description: `Η περίοδος "${upcoming.name}" είναι ενεργή. Βεβαιωθείτε ότι η στρατηγική σας είναι ευθυγραμμισμένη.`,
        suggestions: ['Ελέγξτε τη σύνθεση στρατηγικής', 'Αξιολόγηση campaign performance', 'Προσαρμογή τιμών'],
        data: { period: upcoming.name },
      };
    }

    // Enterprise procurement triggers are placeholders — they check procurementInventory array
    case 'procurement_low_coverage': {
      if (!ctx.procurementInventory?.length) return null;
      const lowCov = ctx.procurementInventory.filter(row => {
        const days = parseFloat(row['ΗΜΕΡΕΣ_ΕΠΑΡΚΕΙΑΣ_ΔΙΑΘΕΣΙΜΟΥ_ΑΠΟΘΕΜΑΤΟΣ'] ?? '999');
        return days < threshold;
      });
      if (lowCov.length === 0) return null;
      return {
        triggerId,
        triggerLabel: 'Χαμηλή επάρκεια',
        severity: 'critical',
        title: `${lowCov.length} κωδικοί με επάρκεια < ${threshold} ημερών`,
        description: 'Κωδικοί με χαμηλή επάρκεια αποθέματος στο ERP. Απαιτείται παραγγελία.',
        suggestions: ['Δημιουργία purchase order', 'Επικοινωνία με προμηθευτή', 'Αξιολόγηση εναλλακτικών'],
        data: { count: lowCov.length },
      };
    }

    case 'procurement_high_surplus': {
      if (!ctx.procurementInventory?.length) return null;
      let surplusValue = 0;
      for (const row of ctx.procurementInventory) {
        const surplus = parseFloat(row['ΔΥΝΑΜΙΚΟ_ΥΠΟΛΟΙΠΟ'] ?? '0') - parseFloat(row['ΔΙΑΘΕΣΙΜΟ_ΥΠΟΛΟΙΠΟ'] ?? '0');
        if (surplus > 0) surplusValue += surplus;
      }
      if (surplusValue <= threshold) return null;
      return {
        triggerId,
        triggerLabel: 'Πλεόνασμα αποθέματος',
        severity: 'warning',
        title: `Πλεόνασμα αποθέματος ${surplusValue.toLocaleString('el-GR')}€`,
        description: 'Υπερβολικό δυναμικό υπόλοιπο στο ERP. Εξετάστε μείωση παραγγελιών.',
        suggestions: ['Μείωση ανοιχτών παραγγελιών', 'Προωθητική ενέργεια', 'Renegotiation με προμηθευτές'],
        data: { surplusValue },
      };
    }

    case 'procurement_new_brand':
    case 'procurement_pricing_drift':
    case 'procurement_supplier_delay': {
      return null;
    }

    case 'price_above_benchmark': {
      const benchmarks = ctx.priceBenchmarks ?? [];
      const thresholdPct = config.threshold ?? 10;
      const aboveThreshold = benchmarks.filter(b => b.priceDiff > thresholdPct);
      if (aboveThreshold.length === 0) return null;
      return {
        triggerId: 'price_above_benchmark',
        triggerLabel: 'Τιμή πάνω από αγορά',
        severity: aboveThreshold.length >= 10 ? 'critical' : 'warning',
        title: `${aboveThreshold.length} SKUs ακριβότερα κατά >${thresholdPct}% από benchmark`,
        description: `Εντοπίστηκαν ${aboveThreshold.length} προϊόντα με τιμή πάνω από τη μέση αγοράς (Merchant Center).`,
        suggestions: [
          'Εξετάστε μείωση τιμών στα SKUs με τη μεγαλύτερη απόκλιση',
          'Ελέγξτε τα margins και κόστος προμήθειας',
          'Ανατρέξτε στο Product Intelligence → vs Market',
        ],
        data: { count: aboveThreshold.length, threshold: thresholdPct },
      };
    }

    case 'competitor_new_ads': {
      const newAdsCount = ctx.competitorNewAdsCount ?? 0;
      const threshold = config.threshold ?? 3;
      if (newAdsCount < threshold) return null;
      return {
        triggerId: 'competitor_new_ads',
        triggerLabel: 'Νέες ads ανταγωνιστών',
        severity: newAdsCount >= 10 ? 'critical' : 'warning',
        title: `${newAdsCount} νέες διαφημίσεις ανταγωνιστών`,
        description: `Εντοπίστηκαν ${newAdsCount} νέες διαφημίσεις ανταγωνιστών από το τελευταίο scan (Meta Ad Library).`,
        suggestions: [
          'Εξετάστε τα μηνύματα και το positioning ανταγωνιστών',
          'Αξιολογήστε αν χρειάζεται αντίδραση στη στρατηγική ads',
          'Δείτε λεπτομέρειες στο Competitive Intel',
        ],
        data: { newAds: newAdsCount, threshold },
      };
    }

    case 'high_churn_ltv': {
      const highValueAtRisk = ctx.segments.filter(seg => {
        const pred = derivePredictiveMetrics(seg);
        return pred.churn_risk > threshold && pred.estimated_ltv > 3000;
      });
      if (highValueAtRisk.length === 0) return null;
      const totalAtRisk = highValueAtRisk.reduce((acc, s) => acc + s.count, 0);
      return {
        triggerId,
        triggerLabel: 'High-LTV churn risk',
        severity: 'critical',
        title: `${totalAtRisk} high-value πελάτες σε κίνδυνο churn`,
        description: `Segments υψηλής αξίας (${highValueAtRisk.map(s => s.name).join(', ')}) εμφανίζουν churn risk > ${threshold}%.`,
        suggestions: [
          'Win-back campaign με VIP offers',
          'Προσωπική επικοινωνία (email/τηλέφωνο) στους top πελάτες',
          'Loyalty program activation',
        ],
        data: { segments: highValueAtRisk.map(s => s.name), totalCustomers: totalAtRisk },
      };
    }

    case 'upsell_opportunity': {
      const upsellSegs = ctx.segments.filter(seg => {
        const beh = deriveBehavioralProfile(seg);
        return beh.upsell_score > threshold;
      });
      if (upsellSegs.length === 0) return null;
      const totalCustomers = upsellSegs.reduce((acc, s) => acc + s.count, 0);
      return {
        triggerId,
        triggerLabel: 'Upsell ευκαιρία',
        severity: 'info',
        title: `${totalCustomers} πελάτες με upsell potential > ${threshold}%`,
        description: `Segments ${upsellSegs.map(s => s.name).join(', ')} δείχνουν υψηλή προδιάθεση για premium αγορές.`,
        suggestions: [
          'Email campaign με premium product recommendations',
          'Dynamic ads με higher-tier προϊόντα',
          'Personalized landing pages ανά segment',
        ],
        data: { segments: upsellSegs.map(s => s.name), totalCustomers },
      };
    }

    case 'engagement_drop': {
      const lowEngagement = ctx.segments.filter(seg => {
        const beh = deriveBehavioralProfile(seg);
        return beh.engagement_score < threshold && seg.count > 100;
      });
      if (lowEngagement.length === 0) return null;
      return {
        triggerId,
        triggerLabel: 'Πτώση engagement',
        severity: 'warning',
        title: `${lowEngagement.length} segments με engagement < ${threshold}%`,
        description: `Χαμηλή αλληλεπίδραση σε: ${lowEngagement.map(s => s.name).join(', ')}. Κίνδυνος περαιτέρω απομάκρυνσης.`,
        suggestions: [
          'Re-engagement email series',
          'SMS win-back με exclusive offer',
          'Survey για κατανόηση αναγκών',
        ],
        data: { segments: lowEngagement.map(s => ({ name: s.name, count: s.count })) },
      };
    }

    case 'demand_declining': {
      const declining = ctx.segments.filter(seg => {
        const pred = derivePredictiveMetrics(seg);
        return pred.demand_trend === 'declining' && seg.revenue_share > 5;
      });
      if (declining.length === 0) return null;
      return {
        triggerId,
        triggerLabel: 'Πτωτική ζήτηση',
        severity: 'warning',
        title: `Πτωτική ζήτηση σε ${declining.length} segments`,
        description: `Segments με σημαντικό revenue share δείχνουν πτωτική τάση: ${declining.map(s => `${s.name} (${s.revenue_share}%)`).join(', ')}.`,
        suggestions: [
          'Ανάλυση αιτιών μείωσης',
          'Ενεργοποίηση retention campaigns',
          'Αξιολόγηση product-market fit',
        ],
        data: { segments: declining.map(s => ({ name: s.name, revenueShare: s.revenue_share })) },
      };
    }

    // ── GA4 Triggers ──

    case 'organic_traffic_spike': {
      if (!ctx.ga4 || ctx.ga4.dailyEntries.length < 14) return null;
      const last7 = ctx.ga4.dailyEntries.slice(-7);
      const prev7 = ctx.ga4.dailyEntries.slice(-14, -7);
      const curr = last7.reduce((a, d) => a + d.sessions, 0);
      const prev = prev7.reduce((a, d) => a + d.sessions, 0);
      if (prev === 0) return null;
      const change = ((curr - prev) / prev) * 100;
      if (change < threshold) return null;
      return {
        triggerId,
        triggerLabel: 'Organic traffic spike',
        severity: change > 50 ? 'critical' : 'info',
        title: `Traffic +${change.toFixed(0)}% τις τελευταίες 7 ημέρες`,
        description: `Οι sessions αυξήθηκαν από ${prev.toLocaleString()} σε ${curr.toLocaleString()} (${change.toFixed(1)}%). Πιθανή ευκαιρία promotion ή stock-up.`,
        suggestions: [
          'Ελέγξτε ποιες σελίδες/κατηγορίες έφεραν traffic',
          'Αξιολογήστε αν χρειάζεται remarketing campaign',
          'Βεβαιωθείτε ότι υπάρχει επαρκές απόθεμα στα popular SKUs',
        ],
        data: { currentSessions: curr, previousSessions: prev, changePercent: change },
      };
    }

    case 'new_visitors_surge': {
      if (!ctx.ga4 || ctx.ga4.dailyEntries.length < 14) return null;
      const last7 = ctx.ga4.dailyEntries.slice(-7);
      const prev7 = ctx.ga4.dailyEntries.slice(-14, -7);
      const curr = last7.reduce((a, d) => a + d.newUsers, 0);
      const prev = prev7.reduce((a, d) => a + d.newUsers, 0);
      if (prev === 0) return null;
      const change = ((curr - prev) / prev) * 100;
      if (change < threshold) return null;
      return {
        triggerId,
        triggerLabel: 'Νέοι επισκέπτες',
        severity: 'info',
        title: `+${change.toFixed(0)}% νέοι χρήστες τις τελευταίες 7 ημέρες`,
        description: `${curr.toLocaleString()} νέοι χρήστες (από ${prev.toLocaleString()}). Acquisition momentum — ευκαιρία remarketing.`,
        suggestions: [
          'Ενεργοποιήστε remarketing campaign για τους νέους επισκέπτες',
          'Δημιουργήστε lookalike audience βάσει αυτής της ομάδας',
          'Ελέγξτε τις πηγές κίνησης (Traffic Sources) για insights',
        ],
        data: { currentNewUsers: curr, previousNewUsers: prev, changePercent: change },
      };
    }

    case 'organic_conversion_drop': {
      if (!ctx.ga4 || ctx.ga4.dailyEntries.length < 14) return null;
      const last7 = ctx.ga4.dailyEntries.slice(-7);
      const prev7 = ctx.ga4.dailyEntries.slice(-14, -7);
      const curr = last7.reduce((a, d) => a + d.conversions, 0);
      const prev = prev7.reduce((a, d) => a + d.conversions, 0);
      if (prev === 0) return null;
      const change = ((prev - curr) / prev) * 100;
      if (change < threshold) return null;
      return {
        triggerId,
        triggerLabel: 'Πτώση conversions',
        severity: change > 30 ? 'critical' : 'warning',
        title: `Conversions -${change.toFixed(0)}% τις τελευταίες 7 ημέρες`,
        description: `Τα conversions μειώθηκαν από ${prev} σε ${curr}. Ελέγξτε αν υπάρχει πρόβλημα στο site ή αλλαγή στο traffic mix.`,
        suggestions: [
          'Ελέγξτε αν αλλάχτηκε κάτι στο site (UX, pricing, checkout)',
          'Αξιολογήστε το traffic mix — μειώθηκε κάποιο quality channel;',
          'Δείτε τις Top Pages για σελίδες με υψηλό bounce rate',
        ],
        data: { currentConversions: curr, previousConversions: prev, dropPercent: change },
      };
    }

    case 'high_bounce_pages': {
      if (!ctx.ga4 || ctx.ga4.topPages.length === 0) return null;
      const bounceThreshold = threshold / 100;
      const highBounce = ctx.ga4.topPages.filter(
        p => p.bounceRate > bounceThreshold && p.sessions > 50
      );
      if (highBounce.length === 0) return null;
      return {
        triggerId,
        triggerLabel: 'Υψηλό bounce rate',
        severity: highBounce.length > 5 ? 'warning' : 'info',
        title: `${highBounce.length} σελίδες με bounce rate > ${threshold}%`,
        description: `Σελίδες με σημαντική κίνηση αλλά υψηλό bounce: ${highBounce.slice(0, 3).map(p => p.path).join(', ')}${highBounce.length > 3 ? ` (+${highBounce.length - 3} ακόμα)` : ''}`,
        suggestions: [
          'Ελέγξτε UX/content σε αυτές τις σελίδες',
          'Βελτιώστε CTAs και internal linking',
          'Αξιολογήστε αν το traffic source ταιριάζει με το content',
        ],
        data: { pages: highBounce.slice(0, 10).map(p => ({ path: p.path, bounceRate: p.bounceRate, sessions: p.sessions })) },
      };
    }

    default:
      return null;
  }
}

export async function runAutomationEvaluation(ctx: EvaluationContext): Promise<TriggerResult[]> {
  const settings = await AutomationSettingsService.get(ctx.brandId);
  const existingAlerts = await AutomationAlertsService.getAll(ctx.brandId);
  const activeAlertTriggers = new Set(
    existingAlerts.filter(a => a.status === 'new').map(a => a.triggerId)
  );
  const results: TriggerResult[] = [];
  const now = new Date();

  for (const triggerDef of TRIGGERS_CATALOG) {
    if (triggerDef.planRequired === 'enterprise' && ctx.plan !== 'enterprise') continue;

    const config = settings.triggers[triggerDef.id];
    if (!config?.enabled) continue;

    // Skip if there's already an active (undismissed) alert for this trigger
    if (activeAlertTriggers.has(triggerDef.id)) continue;

    if (config.lastCheckedAt) {
      const lastCheck = new Date(config.lastCheckedAt);
      const daysSince = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < config.checkIntervalDays) continue;
    }

    const result = evaluateTrigger(triggerDef.id, config, ctx);

    await AutomationSettingsService.updateTrigger(ctx.brandId, triggerDef.id, {
      lastCheckedAt: now.toISOString(),
    });

    if (result) {
      const alertId = await AutomationAlertsService.create({
        brandId: ctx.brandId,
        triggerId: result.triggerId,
        triggerLabel: result.triggerLabel,
        triggerGroup: triggerDef.group,
        severity: result.severity,
        title: result.title,
        description: result.description,
        suggestions: result.suggestions,
        status: 'new',
        data: result.data,
      });

      if (config.autoBriefing) {
        const decId = await DecisionsService.create({
          brandId: ctx.brandId,
          title: result.title,
          description: `${result.description}\n\nΠροτάσεις:\n${result.suggestions.map(s => `• ${s}`).join('\n')}`,
          category: 'general',
          priority: result.severity === 'critical' ? 'urgent' : result.severity === 'warning' ? 'high' : 'medium',
          status: 'active',
          targetDepartments: ['commercial', 'marketing'],
          createdBy: ctx.userId,
          createdByName: ctx.userName,
        });

        await AutomationAlertsService.updateStatus(alertId, 'acted', decId);

        await logAndNotify(
          ctx.brandId, ctx.userId, ctx.userName,
          'decision_created', 'decision', decId,
          `Αυτοματισμός: ${result.title}`,
          'Αυτόματη απόφαση', result.title,
          ['commercial', 'marketing']
        );
      }

      results.push(result);
    }
  }

  return results;
}
