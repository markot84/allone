import { analyzeMarketingDecisions } from './marketingSpendImpact';
import { analyzePriceChangeImpact } from './priceChangeImpact';
import type { Campaign } from '../types';
import type { EcommerceRawOrder } from './ecommerceRawOrders';

export interface CommercialLearning {
  id: string;
  kind: 'marketing' | 'price';
  title: string;
  detail: string;
  verdict: 'positive' | 'negative';
}

export interface CommercialLearnings {
  /** Επιτυχημένες αποφάσεις marketing — «επανέλαβε». */
  wins: CommercialLearning[];
  /** Αποτυχημένες αποφάσεις marketing — «απόφυγε/διόρθωσε». */
  misses: CommercialLearning[];
  /** Αλλαγές τιμών με θετική επίδραση τζίρου. */
  priceWins: CommercialLearning[];
}

function isActionable(confidence: 'low' | 'medium' | 'high'): boolean {
  return confidence !== 'low';
}

function pricedirectionLabel(direction: 'increase' | 'decrease'): string {
  return direction === 'decrease' ? 'Μείωση τιμής' : 'Αύξηση τιμής';
}

/**
 * Συγκεντρώνει «μαθήματα» από προηγούμενες εμπορικές αποφάσεις (marketing budget + τιμές) σε ένα
 * trailing παράθυρο, για να τροφοδοτήσει το Marketing Plan με actionable ιδέες για μελλοντικά πλάνα.
 */
export function buildCommercialLearnings(input: {
  campaigns: Campaign[];
  orders: EcommerceRawOrder[];
  windowFrom: string;
  windowTo: string;
  costBySku?: Map<string, number>;
  skuNames?: Map<string, string>;
  maxPerGroup?: number;
}): CommercialLearnings {
  const costBySku = input.costBySku ?? new Map<string, number>();
  const max = input.maxPerGroup ?? 5;

  const marketing = analyzeMarketingDecisions({
    campaigns: input.campaigns,
    orders: input.orders,
    periodFrom: input.windowFrom,
    periodTo: input.windowTo,
    costBySku,
  });

  const wins: CommercialLearning[] = marketing.rows
    .filter((r) => r.verdict === 'positive' && isActionable(r.confidence))
    .slice(0, max)
    .map((r) => ({ id: `mkt_${r.id}`, kind: 'marketing', title: r.title, detail: r.idea, verdict: 'positive' }));

  const misses: CommercialLearning[] = marketing.rows
    .filter((r) => r.verdict === 'negative' && isActionable(r.confidence))
    .slice(0, max)
    .map((r) => ({ id: `mkt_${r.id}`, kind: 'marketing', title: r.title, detail: r.idea, verdict: 'negative' }));

  const price = analyzePriceChangeImpact({
    orders: input.orders,
    periodFrom: input.windowFrom,
    periodTo: input.windowTo,
    costBySku,
    skuNames: input.skuNames,
  });

  const priceWins: CommercialLearning[] = price.rows
    .filter((r) => r.verdict === 'positive' && r.confidence !== 'low')
    .slice(0, max)
    .map((r) => {
      const rev = r.revenueChangePct;
      const revText = rev != null ? `τζίρος ${rev >= 0 ? '+' : ''}${rev}%` : 'βελτίωση τζίρου';
      return {
        id: `price_${r.sku}_${r.changeDate}`,
        kind: 'price',
        title: r.productName || r.sku,
        detail: `${pricedirectionLabel(r.direction)} ${r.changePct >= 0 ? '+' : ''}${r.changePct}% → ${revText}. Επανάλαβε σε παρόμοια προϊόντα.`,
        verdict: 'positive',
      };
    });

  return { wins, misses, priceWins };
}
