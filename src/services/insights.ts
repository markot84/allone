import type { Product, RFMSegment, AIInsight } from '../types';
import { classifyStockHealth, getProductTod } from '../utils/productUtils';
import { groupProductsForDecisionExport, isActionableStockProduct } from '../utils/actionableProducts';

/** Generate dynamic AI insights from real products and segments data */
export function generateInsightsFromData(
  products: Product[],
  segments: RFMSegment[],
  supplierTodMap?: Map<string, number>,
  ecommerce?: {
    /** Πραγματικός τζίρος/παραγγελίες — όχι απλά «υπάρχει connector». */
    hasData: boolean;
    hasConnector?: boolean;
    totalRevenue: number;
    orderCount: number;
    aov: number;
    platformBreakdown: { platform: string; revenue: number; orders: number }[];
  },
  /**
   * Αν υπάρχει ενεργή στρατηγική με AI-επιλεγμένα segments, τα περνάμε εδώ
   * ώστε τα segment insights να ευθυγραμμιστούν με τη στρατηγική.
   */
  activeStrategy?: {
    name?: string;
    targetSegmentNames?: string[]; // π.χ. ['Potential Loyalists', 'At Risk', 'Promising']
  } | null
): AIInsight[] {
  const insights: AIInsight[] = [];

  if (ecommerce?.hasConnector && !ecommerce.hasData) {
    insights.push({
      insightKey: 'ecomm_metrics_pending',
      type: 'recommendation',
      icon: '',
      title: 'E-shop: δεν φορτώθηκαν ακόμα παραγγελίες/τζίρος',
      insight:
        'Υπάρχει σύνδεση e-shop αλλά τα σύνολα παραγγελιών/εσόδων είναι κενά. Ανανέωση σελίδας ή sync connector — τα insights από προϊόντα/segments μπορεί να μην αντικατοπτρίζουν το οικονομικό αποτέλεσμα.',
      action: 'Άνοιγμα Συνδέσεις / Sync',
      impact: 'medium',
    });
  }

  const actionableProducts = products.filter(isActionableStockProduct);
  const classify = (p: Product) => {
    const tag = String(p.priority_tag || '').toLowerCase();
    if (tag === 'dead' || tag === 'low' || tag === 'healthy' || tag === 'excess') return tag;
    return classifyStockHealth(p, getProductTod(p, supplierTodMap));
  };
  const deadStock = actionableProducts.filter((p) => classify(p) === 'dead');
  const deadStockModels = groupProductsForDecisionExport(deadStock);
  const lowStock = actionableProducts.filter((p) => classify(p) === 'low');
  const excessStock = actionableProducts.filter((p) => classify(p) === 'excess');
  const highMarginProducts = actionableProducts.filter(
    (p) => p.margin_tier === 'high' || (p.margin_percentage ?? 0) > 25
  );
  const highMarginLowStock = highMarginProducts.filter(
    (p) => classify(p) === 'low'
  );

  if (deadStockModels.length > 0) {
    insights.push({
      insightKey: 'dead_stock',
      type: 'warning',
      icon: '',
      title: 'Dead stock — χωρίς πωλήσεις',
      insight: `${deadStockModels.length} ενεργά προϊόντα/model groups με απόθεμα δεν εμφάνισαν πωλήσεις στην τελευταία περίοδο. Απαιτείται σχέδιο εκκαθάρισης ή επανατοποθέτησης.`,
      action: 'Δημιουργία Campaign',
      impact: 'high',
    });
  }

  if (excessStock.length > 0) {
    insights.push({
      insightKey: 'excess_stock',
      type: 'warning',
      icon: '',
      title: 'Πλεόνασμα αποθέματος',
      insight: `${excessStock.length} κωδικοί υπερβαίνουν σημαντικά τον στόχο αποθέματος και δεσμεύουν κεφάλαιο χωρίς επαρκή κυκλοφορία.`,
      action: 'Δημιουργία Προσφορών',
      impact: 'high',
    });
  }

  if (highMarginLowStock.length > 0) {
    insights.push({
      insightKey: 'high_margin_low_stock',
      type: 'opportunity',
      icon: '',
      title: 'High-margin items με low stock',
      insight: `${highMarginLowStock.length} προϊόντα υψηλού περιθωρίου κινούνται προς έλλειψη. Χρειάζεται προτεραιοποίηση αναπλήρωσης.`,
      action: 'Πρόταση αναπλήρωσης',
      impact: 'medium',
    });
  }

  if (lowStock.length > 5 && actionableProducts.length > 0) {
    insights.push({
      insightKey: 'low_stock',
      type: 'recommendation',
      icon: '',
      title: 'Χαμηλά αποθέματα',
      insight: `${lowStock.length} ενεργά προϊόντα (${Math.round((lowStock.length / actionableProducts.length) * 100)}%) κινούνται προς εξάντληση εντός περίπου ${Math.round(60 / 2)} ημερών.`,
      action: 'Ελέγξτε Inventory',
      impact: 'medium',
    });
  }

  // Segments-based insights
  const totalCustomers = segments.reduce((sum, s) => sum + (s.count ?? 0), 0);
  const strategySegments = activeStrategy?.targetSegmentNames ?? [];
  const hasActiveStrategy = strategySegments.length > 0;

  if (hasActiveStrategy) {
    // Ενεργή στρατηγική: ένα ενοποιημένο insight που ευθυγραμμίζεται με το Channel Activation.
    // Αντικαθιστά τα ανεξάρτητα champions/at_risk/top_segment insights ώστε ο χρήστης
    // να βλέπει παντού τα ίδια segments με προτεραιότητα.
    const segmentList = strategySegments.join(', ');
    const strategyName = activeStrategy?.name ? `«${activeStrategy.name}»` : 'την ενεργή στρατηγική';
    insights.push({
      insightKey: 'strategy_segments',
      type: 'recommendation',
      icon: '',
      title: `AI Στόχευση — ${strategyName}`,
      insight: `Το AI επέλεξε ${strategySegments.length} segments για ${strategyName}: ${segmentList}. Αυτά αποτελούν την κύρια προτεραιότητα ενεργοποίησης.`,
      action: 'Channel Activation',
      impact: 'high',
    });
  } else {
    // Χωρίς ενεργή στρατηγική: data-driven segment insights
    const atRisk = segments.find((s) => s.id === 'at_risk' || s.name?.toLowerCase().includes('at risk'));
    const champions = segments.find((s) => s.id === 'champions' || s.name?.toLowerCase().includes('champion'));

    if (atRisk && (atRisk.percentage ?? 0) > 15) {
      insights.push({
        insightKey: 'at_risk_segment',
        type: 'warning',
        icon: '',
        title: 'At Risk segment σε αύξηση',
        insight: `Το segment "${atRisk.name}" αντιστοιχεί στο ${atRisk.percentage}% της πελατειακής βάσης. Απαιτείται στοχευμένη ενέργεια επανενεργοποίησης.`,
        action: 'Launch Win-back',
        impact: 'high',
      });
    }

    if (champions && (champions.revenue_share ?? 0) > 30) {
      insights.push({
        insightKey: 'champions_segment',
        type: 'opportunity',
        icon: '',
        title: 'Champions segment opportunity',
        insight: `Τα Champions συνεισφέρουν ${champions.revenue_share}% των εσόδων. Αξίζει ελεγχόμενη αξιοποίηση για διατήρηση και επιλεκτικό upsell.`,
        action: 'Δημιουργία Campaign',
        impact: 'high',
      });
    }

    if (segments.length > 0 && totalCustomers > 0) {
      const topSegment = segments.reduce((a, b) => ((a.revenue_share ?? 0) > (b.revenue_share ?? 0) ? a : b));
      insights.push({
        insightKey: 'top_segment',
        type: 'recommendation',
        icon: '',
        title: 'Κορυφαίο segment',
        insight: `Το "${topSegment.name}" εμφανίζει τη μεγαλύτερη συμμετοχή στα έσοδα (${topSegment.revenue_share}%). Αποτελεί βασική προτεραιότητα στόχευσης.`,
        action: 'Στόχευση Campaign',
        impact: 'medium',
      });
    }
  }

  // Cross-sell when we have both
  if (products.length >= 5 && segments.length >= 2) {
    const categories = [...new Set(products.map((p) => p.category))].filter(Boolean);
    if (categories.length >= 2) {
      insights.push({
        insightKey: 'cross_sell',
        type: 'opportunity',
        icon: '',
        title: 'Δυνατότητα cross-sell',
        insight: `${categories.length} κατηγορίες προϊόντων και ${segments.length} segments δημιουργούν πεδίο για στοχευμένες προτάσεις cross-sell ανά κοινό.`,
        action: 'Setup Sequence',
        impact: 'medium',
      });
    }
  }

  // E-commerce insights
  if (ecommerce?.hasData && ecommerce.totalRevenue > 0) {
    if (ecommerce.aov > 0 && ecommerce.aov < 35) {
      insights.push({
        insightKey: 'ecomm_low_aov',
        type: 'opportunity',
        icon: '',
        title: 'Χαμηλό AOV στο e-shop',
        insight: `Το AOV διαμορφώνεται στα €${ecommerce.aov.toFixed(2)}. Εξετάστε bundles ή όρια κινήτρων για ενίσχυση της μέσης αξίας καλαθιού.`,
        action: 'Δείτε E-commerce Explorer',
        impact: 'medium',
      });
    }

    if (ecommerce.platformBreakdown?.length > 0) {
      const top = ecommerce.platformBreakdown[0];
      const topShare = ecommerce.totalRevenue > 0 ? (top.revenue / ecommerce.totalRevenue) * 100 : 0;
      if (topShare >= 70) {
        insights.push({
          insightKey: 'ecomm_platform_risk',
          type: 'warning',
          icon: '',
          title: 'Υψηλή εξάρτηση από μία πλατφόρμα',
          insight: `${top.platform} παράγει περίπου το ${Math.round(topShare)}% του store revenue. Υπάρχει αυξημένη συγκέντρωση ρίσκου σε μία πλατφόρμα.`,
          action: 'Ανάλυση ανά πλατφόρμα',
          impact: 'high',
        });
      }
    }
  }

  return insights;
}
