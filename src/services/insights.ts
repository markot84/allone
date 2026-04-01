import type { Product, RFMSegment, AIInsight } from '../types';
import { classifyStockHealth, getProductTod } from '../utils/productUtils';

/** Generate dynamic AI insights from real products and segments data */
export function generateInsightsFromData(
  products: Product[],
  segments: RFMSegment[],
  supplierTodMap?: Map<string, number>
): AIInsight[] {
  const insights: AIInsight[] = [];

  const classify = (p: Product) => classifyStockHealth(p, getProductTod(p, supplierTodMap));
  const deadStock = products.filter((p) => classify(p) === 'dead');
  const lowStock = products.filter((p) => classify(p) === 'low');
  const excessStock = products.filter((p) => classify(p) === 'excess');
  const highMarginProducts = products.filter(
    (p) => p.margin_tier === 'high' || (p.margin_percentage ?? 0) > 25
  );
  const highMarginLowStock = highMarginProducts.filter(
    (p) => classify(p) === 'low'
  );

  if (deadStock.length > 0) {
    insights.push({
      insightKey: 'dead_stock',
      type: 'warning',
      icon: '',
      title: 'Dead stock — χωρίς πωλήσεις',
      insight: `${deadStock.length} SKU(s) χωρίς πωλήσεις στην τελευταία περίοδο. Ιδανικό για clearance campaigns.`,
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
      insight: `${excessStock.length} SKU(s) με απόθεμα > 2x του στόχου. Δεσμεύουν κεφάλαιο.`,
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
      insight: `${highMarginLowStock.length} high-margin προϊόντα κινδυνεύουν να εξαντληθούν. Προτεραιότητα αναπλήρωσης.`,
      action: 'Πρόταση αναπλήρωσης',
      impact: 'medium',
    });
  }

  if (lowStock.length > 5 && products.length > 0) {
    insights.push({
      insightKey: 'low_stock',
      type: 'recommendation',
      icon: '',
      title: 'Χαμηλά αποθέματα',
      insight: `${lowStock.length} προϊόντα (${Math.round((lowStock.length / products.length) * 100)}%) θα εξαντληθούν σε < ${Math.round(60 / 2)} ημέρες.`,
      action: 'Ελέγξτε Inventory',
      impact: 'medium',
    });
  }

  // Segments-based insights
  const atRisk = segments.find((s) => s.id === 'at_risk' || s.name?.toLowerCase().includes('at risk'));
  const champions = segments.find((s) => s.id === 'champions' || s.name?.toLowerCase().includes('champion'));
  const totalCustomers = segments.reduce((sum, s) => sum + (s.count ?? 0), 0);

  if (atRisk && (atRisk.percentage ?? 0) > 15) {
    insights.push({
      insightKey: 'at_risk_segment',
      type: 'warning',
      icon: '',
      title: 'At Risk segment σε αύξηση',
      insight: `Το segment "${atRisk.name}" έχει ${atRisk.percentage}% των πελατών. Προτείνεται win-back campaign.`,
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
      insight: `Τα Champions συνεισφέρουν ${champions.revenue_share}% του revenue. Exclusive offers για retention.`,
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
      insight: `"${topSegment.name}" έχει το μεγαλύτερο revenue share (${topSegment.revenue_share}%). Προτεραιότητα στόχευσης.`,
      action: 'Στόχευση Campaign',
      impact: 'medium',
    });
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
        insight: `${categories.length} κατηγορίες προϊόντων και ${segments.length} segments. Προσαρμόστε προσφορές ανά segment.`,
        action: 'Setup Sequence',
        impact: 'medium',
      });
    }
  }

  return insights;
}
