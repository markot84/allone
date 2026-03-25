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
}

interface TriggerResult {
  triggerId: string;
  triggerLabel: string;
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
      return {
        triggerId,
        triggerLabel: 'Υψηλή απόδοση campaign',
        severity: 'info',
        title: `${highPerf.length} campaigns με ROAS > ${threshold}x`,
        description: 'Ορισμένα campaigns αποδίδουν εξαιρετικά. Εξετάστε αύξηση budget.',
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
      return {
        triggerId,
        triggerLabel: 'Churn risk',
        severity: (atRisk.percentage ?? 0) > threshold * 1.5 ? 'critical' : 'warning',
        title: `At-risk segment στο ${atRisk.percentage?.toFixed(1)}%`,
        description: `${atRisk.count} πελάτες κινδυνεύουν να χαθούν. Απαιτείται win-back στρατηγική.`,
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
      return null;
    }

    case 'competitor_new_ads': {
      return null;
    }

    default:
      return null;
  }
}

export async function runAutomationEvaluation(ctx: EvaluationContext): Promise<TriggerResult[]> {
  const settings = await AutomationSettingsService.get(ctx.brandId);
  const results: TriggerResult[] = [];
  const now = new Date();

  for (const triggerDef of TRIGGERS_CATALOG) {
    if (triggerDef.planRequired === 'enterprise' && ctx.plan !== 'enterprise') continue;

    const config = settings.triggers[triggerDef.id];
    if (!config?.enabled) continue;

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
