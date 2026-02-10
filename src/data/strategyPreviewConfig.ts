export type PreviewColumnId =
  | 'rank'
  | 'product'
  | 'category'
  | 'margin'
  | 'stock'
  | 'stock_age'
  | 'excess_pct'
  | 'priority_tag'
  | 'revenue_potential'
  | 'score';

export interface PreviewColumnConfig {
  id: PreviewColumnId;
  label: string;
  /** Optional: header tooltip for Score column */
  tooltip?: string;
}

export interface StrategyPreviewConfig {
  columns: PreviewColumnConfig[];
  scoreTooltip: string;
}

const SCORE_TOOLTIPS: Record<string, string> = {
  profit_max: `Score = weighted sum of 5 factors:
• Profitability (40%): Margin % – προτεραιότητα σε high-margin προϊόντα
• Inventory (15%): Stock level & age
• Strategic (15%): New Launch, Brand Push, Best Seller tags
• Revenue (10%): Price × Stock (revenue potential)
• Customer Fit (20%): Segment affinity`,

  stock_clearance: `Score = weighted sum of 5 factors:
• Inventory (45%): Υψηλό stock ratio & παλιό stock = προτεραιότητα
• Profitability (15%): Margin για να μην χασουμε λεφτά
• Strategic (10%): Clearance tag bonus
• Revenue (10%): Volume potential
• Customer Fit (20%): Segment affinity
Προτεραιότητα σε προϊόντα με excess stock και μεγάλο stock age.`,

  brand_launch: `Score = weighted sum of 5 factors:
• Strategic (50%): New Launch, Brand Push = υψηλό score
• Profitability (10%): Margin
• Inventory (10%): Διαθεσιμότητα
• Revenue (10%): Volume
• Customer Fit (20%): Target segment affinity
Προτεραιότητα σε προϊόντα με tags: New Launch, Brand Push, Best Seller.`,

  revenue_push: `Score = weighted sum of 5 factors:
• Revenue (35%): Price × Stock – revenue potential
• Profitability (15%): Margin
• Inventory (15%): Stock για fulfillment
• Strategic (15%): Best Seller, Seasonal
• Customer Fit (20%): Segment affinity
Προτεραιότητα σε προϊόντα με υψηλό revenue potential (τιμή × stock).`,

  custom: `Score = weighted sum based on τις weights που επέλεξες.
Κάθε factor συνεισφέρει ανάλογα με το ποσοστό του.`,
};

export const strategyPreviewConfigs: Record<string, StrategyPreviewConfig> = {
  profit_max: {
    columns: [
      { id: 'rank', label: 'Rank' },
      { id: 'product', label: 'Product' },
      { id: 'category', label: 'Category' },
      { id: 'margin', label: 'Margin' },
      { id: 'stock', label: 'Stock' },
      { id: 'score', label: 'Score', tooltip: SCORE_TOOLTIPS.profit_max },
    ],
    scoreTooltip: SCORE_TOOLTIPS.profit_max,
  },

  stock_clearance: {
    columns: [
      { id: 'rank', label: 'Rank' },
      { id: 'product', label: 'Product' },
      { id: 'category', label: 'Category' },
      { id: 'stock', label: 'Stock' },
      { id: 'stock_age', label: 'Stock Age' },
      { id: 'excess_pct', label: 'Excess %' },
      { id: 'score', label: 'Score', tooltip: SCORE_TOOLTIPS.stock_clearance },
    ],
    scoreTooltip: SCORE_TOOLTIPS.stock_clearance,
  },

  brand_launch: {
    columns: [
      { id: 'rank', label: 'Rank' },
      { id: 'product', label: 'Product' },
      { id: 'category', label: 'Category' },
      { id: 'priority_tag', label: 'Priority' },
      { id: 'margin', label: 'Margin' },
      { id: 'score', label: 'Score', tooltip: SCORE_TOOLTIPS.brand_launch },
    ],
    scoreTooltip: SCORE_TOOLTIPS.brand_launch,
  },

  revenue_push: {
    columns: [
      { id: 'rank', label: 'Rank' },
      { id: 'product', label: 'Product' },
      { id: 'category', label: 'Category' },
      { id: 'revenue_potential', label: 'Revenue Potential' },
      { id: 'margin', label: 'Margin' },
      { id: 'score', label: 'Score', tooltip: SCORE_TOOLTIPS.revenue_push },
    ],
    scoreTooltip: SCORE_TOOLTIPS.revenue_push,
  },

  custom: {
    columns: [
      { id: 'rank', label: 'Rank' },
      { id: 'product', label: 'Product' },
      { id: 'category', label: 'Category' },
      { id: 'margin', label: 'Margin' },
      { id: 'stock', label: 'Stock' },
      { id: 'score', label: 'Score', tooltip: SCORE_TOOLTIPS.custom },
    ],
    scoreTooltip: SCORE_TOOLTIPS.custom,
  },
};

export function getPreviewConfig(selectedScenario: string, weights: Record<string, number>): StrategyPreviewConfig {
  const base = strategyPreviewConfigs[selectedScenario] ?? strategyPreviewConfigs.custom;
  if (selectedScenario === 'custom') {
    const customTooltip = `Score = weighted sum based on τις weights που επέλεξες:
• Profitability: ${weights.profit ?? 0}%
• Inventory: ${weights.stock ?? 0}%
• Strategic: ${weights.strategic ?? 0}%
• Revenue: ${weights.revenue ?? 0}%
• Customer Fit: ${weights.fit ?? 0}%`;
    return {
      ...base,
      scoreTooltip: customTooltip,
      columns: base.columns.map((c) =>
        c.id === 'score' ? { ...c, tooltip: customTooltip } : c
      ),
    };
  }
  return base;
}
