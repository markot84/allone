import type { AIInsight } from '../types';

export const aiInsights: AIInsight[] = [
  {
    type: 'opportunity',
    icon: '',
    title: 'Champions segment opportunity',
    insight: 'Τα Champions έχουν 3x higher affinity για Premium Electronics. Σύσταση: Exclusive early access σε νέα launches.',
    action: 'Create Campaign',
    impact: 'high'
  },
  {
    type: 'warning',
    icon: '',
    title: 'At Risk segment growing',
    insight: '+15% migration προς At Risk τον τελευταίο μήνα. Κυρίως από Loyal segment.',
    action: 'Launch Win-back',
    impact: 'high'
  },
  {
    type: 'recommendation',
    icon: '',
    title: 'Stock clearance opportunity',
    insight: '234 SKUs με stock age > 90 days έχουν high affinity με Potential Loyalists. Ideal για acquisition campaigns.',
    action: 'Generate Feed',
    impact: 'medium'
  },
  {
    type: 'opportunity',
    icon: '',
    title: 'Cross-sell potential identified',
    insight: 'Champions που αγόρασαν Home Appliances έχουν 72% probability να αγοράσουν Home & Living επόμενο μήνα.',
    action: 'Setup Sequence',
    impact: 'high'
  },
  {
    type: 'recommendation',
    icon: '',
    title: 'High-margin focus',
    insight: '156 high-margin SKUs με healthy stock levels are underperforming. Recommend priority in Google Shopping feed.',
    action: 'Optimize Feed',
    impact: 'medium'
  },
  {
    type: 'warning',
    icon: '',
    title: 'Seasonal stock risk',
    insight: '89 seasonal items approaching off-season. Recommend flash sale για Champions & Loyal segments.',
    action: 'Plan Campaign',
    impact: 'high'
  }
];

export const dashboardKPIs = [
  {
    label: 'Total Revenue',
    value: '€847.5K',
    change: 12.4,
    changeLabel: 'vs last period',
    trend: 'up' as const,
    sparklineData: [645, 678, 712, 798, 923, 847]
  },
  {
    label: 'Customer LTV',
    value: '€342',
    change: 8.2,
    changeLabel: 'vs last period',
    trend: 'up' as const,
    sparklineData: [285, 298, 312, 325, 338, 342]
  },
  {
    label: 'Segment Health',
    value: '78%',
    change: 5.6,
    changeLabel: 'healthy segments',
    trend: 'up' as const,
    sparklineData: [68, 70, 72, 74, 76, 78]
  },
  {
    label: 'Inventory Turnover',
    value: '4.2x',
    change: -2.1,
    changeLabel: 'vs target',
    trend: 'down' as const,
    sparklineData: [3.8, 4.0, 4.1, 4.3, 4.4, 4.2]
  },
  {
    label: 'Avg ROAS',
    value: '5.8x',
    change: 18.3,
    changeLabel: 'improvement',
    trend: 'up' as const,
    sparklineData: [4.2, 4.5, 4.8, 5.2, 5.6, 5.8]
  },
  {
    label: 'Performance+ ROI',
    value: '64x',
    change: 36.9,
    changeLabel: 'attributed',
    trend: 'up' as const,
    sparklineData: [0, 12, 28, 42, 56, 64]
  }
];
