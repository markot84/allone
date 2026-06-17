import type { Product, RFMSegment, AIInsight, InventorySummary } from '../types';
import { classifyStockHealth, getProductTod } from '../utils/productUtils';
import { groupProductsForDecisionExport, isActionableStockProduct } from '../utils/actionableProducts';

/** Inventory aggregate from PI (`product_intelligence/{brandId}`, 1 read); feeds
 *  product insight cards instead of the full product list. */
export interface InsightInventoryAggregate {
  summary: InventorySummary;
  categoriesCount: number;
  totalCount: number;
}

/** Generate dynamic AI insights from real products and segments data */
export function generateInsightsFromData(
  products: Product[],
  segments: RFMSegment[],
  supplierTodMap?: Map<string, number>,
  ecommerce?: {
    /** Real revenue/orders — not merely "a connector exists". */
    hasData: boolean;
    hasConnector?: boolean;
    totalRevenue: number;
    orderCount: number;
    aov: number;
    platformBreakdown: { platform: string; revenue: number; orders: number }[];
  },
  /** Active strategy with AI-selected segments, so segment insights align with it. */
  activeStrategy?: {
    name?: string;
    targetSegmentNames?: string[]; // e.g. ['Potential Loyalists', 'At Risk', 'Promising']
  } | null,
  /** When provided, product cards are computed from the aggregate (no products read). */
  inventory?: InsightInventoryAggregate | null
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

  if (inventory) {
    // Product cards from the PI aggregate summary — same insightKeys, only the number source changes.
    const s = inventory.summary;
    // stockedCount from counts — NEVER summary.*.percentage: its total_skus denominator is inflated ~6x by tombstones.
    const stockedCount = s.healthy_stock.count + s.low_stock.count + s.dead_stock.count + s.excess_stock.count;

    if (s.dead_stock.count > 0) {
      insights.push({
        insightKey: 'dead_stock',
        type: 'warning',
        icon: '',
        title: 'Dead stock — χωρίς πωλήσεις',
        insight: `${s.dead_stock.count} κωδικοί με απόθεμα δεν εμφάνισαν πωλήσεις στην τελευταία περίοδο. Απαιτείται σχέδιο εκκαθάρισης ή επανατοποθέτησης.`,
        action: 'Δημιουργία Campaign',
        impact: 'high',
      });
    }

    if (s.excess_stock.count > 0) {
      insights.push({
        insightKey: 'excess_stock',
        type: 'warning',
        icon: '',
        title: 'Πλεόνασμα αποθέματος',
        insight: `${s.excess_stock.count} κωδικοί υπερβαίνουν σημαντικά τον στόχο αποθέματος και δεσμεύουν κεφάλαιο χωρίς επαρκή κυκλοφορία.`,
        action: 'Δημιουργία Προσφορών',
        impact: 'high',
      });
    }

    // high_margin_low_stock: no aggregate field — same conditional render as when there are no matches.

    if (s.low_stock.count > 5) {
      insights.push({
        insightKey: 'low_stock',
        type: 'recommendation',
        icon: '',
        title: 'Χαμηλά αποθέματα',
        insight: `${s.low_stock.count} ενεργά προϊόντα (${Math.round((s.low_stock.count / stockedCount) * 100)}%) κινούνται προς εξάντληση εντός περίπου ${Math.round(60 / 2)} ημερών.`,
        action: 'Ελέγξτε Inventory',
        impact: 'medium',
      });
    }
  } else {
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
  }

  // Segments-based insights
  const totalCustomers = segments.reduce((sum, s) => sum + (s.count ?? 0), 0);
  const strategySegments = activeStrategy?.targetSegmentNames ?? [];
  const hasActiveStrategy = strategySegments.length > 0;

  if (hasActiveStrategy) {
    // Active strategy: one unified insight aligned with Channel Activation, replacing the
    // independent champions/at_risk/top_segment insights so segments are prioritized consistently.
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
    // No active strategy: data-driven segment insights
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
  const crossSellHasProducts = inventory ? inventory.totalCount >= 5 : products.length >= 5;
  const crossSellCategoryCount = inventory
    ? inventory.categoriesCount
    : [...new Set(products.map((p) => p.category))].filter(Boolean).length;
  if (crossSellHasProducts && segments.length >= 2) {
    if (crossSellCategoryCount >= 2) {
      insights.push({
        insightKey: 'cross_sell',
        type: 'opportunity',
        icon: '',
        title: 'Δυνατότητα cross-sell',
        insight: `${crossSellCategoryCount} κατηγορίες προϊόντων και ${segments.length} segments δημιουργούν πεδίο για στοχευμένες προτάσεις cross-sell ανά κοινό.`,
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
