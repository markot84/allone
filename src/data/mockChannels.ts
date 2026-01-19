import type { ChannelAllocation } from '../types';

export const channelMixByScenario: Record<string, { total_budget: number; allocation: ChannelAllocation[] }> = {
  profit_max: {
    total_budget: 15000,
    allocation: [
      {
        channel: 'Email Marketing',
        budget: 3750,
        percentage: 25,
        target_segments: ['Champions', 'Loyal'],
        expected_roas: 9.2,
        priority_products: ['High-margin items', 'Premium categories'],
        rationale: 'Highest ROI channel με zero media cost for owned audience'
      },
      {
        channel: 'Loyalty Programs',
        budget: 3000,
        percentage: 20,
        target_segments: ['Champions'],
        expected_roas: 7.8,
        priority_products: ['Exclusive offers', 'Bundle deals'],
        rationale: 'Retention focus με high LTV customers'
      },
      {
        channel: 'Google Shopping (CSS)',
        budget: 3000,
        percentage: 20,
        target_segments: ['Potential Loyalists', 'New Customers'],
        expected_roas: 4.5,
        priority_products: ['High-margin SKUs', 'Best sellers'],
        rationale: 'CSS partnership reduces CPC for profitable acquisition'
      },
      {
        channel: 'Meta Ads',
        budget: 2625,
        percentage: 17.5,
        target_segments: ['Potential Loyalists', 'Lookalikes'],
        expected_roas: 3.8,
        priority_products: ['Visual-first products', 'Lifestyle items'],
        rationale: 'Targeted acquisition με look-alike audiences'
      },
      {
        channel: 'Remarketing Display',
        budget: 2625,
        percentage: 17.5,
        target_segments: ['At Risk', 'Cart Abandoners'],
        expected_roas: 5.5,
        priority_products: ['Previously viewed', 'Abandoned items'],
        rationale: 'Re-capture high-intent traffic efficiently'
      }
    ]
  },
  stock_clearance: {
    total_budget: 15000,
    allocation: [
      {
        channel: 'Google Shopping (CSS)',
        budget: 4500,
        percentage: 30,
        target_segments: ['Potential Loyalists', 'New Customers'],
        expected_roas: 4.2,
        priority_products: ['Clearance items', 'High-stock SKUs'],
        rationale: 'Reduced CPC via CSS partnership, ideal για volume push'
      },
      {
        channel: 'Meta Ads',
        budget: 3750,
        percentage: 25,
        target_segments: ['At Risk', 'Potential Loyalists'],
        expected_roas: 3.8,
        priority_products: ['Seasonal items', 'Brand push products'],
        rationale: 'Visual-first platform για awareness και re-engagement'
      },
      {
        channel: 'Email Marketing',
        budget: 3000,
        percentage: 20,
        target_segments: ['Champions', 'Loyal'],
        expected_roas: 8.5,
        priority_products: ['Personalized recommendations', 'Flash sales'],
        rationale: 'Highest ROI channel για existing customer base'
      },
      {
        channel: 'Remarketing Display',
        budget: 2250,
        percentage: 15,
        target_segments: ['At Risk', 'Cart Abandoners'],
        expected_roas: 5.2,
        priority_products: ['Previously viewed', 'Complementary items'],
        rationale: 'Re-capture intent με personalized creative'
      },
      {
        channel: 'SMS/Push',
        budget: 1500,
        percentage: 10,
        target_segments: ['Champions', 'Loyal'],
        expected_roas: 6.8,
        priority_products: ['Time-sensitive offers', 'Exclusive deals'],
        rationale: 'High-impact για urgent stock clearance'
      }
    ]
  },
  brand_launch: {
    total_budget: 18000,
    allocation: [
      {
        channel: 'Meta Ads',
        budget: 5400,
        percentage: 30,
        target_segments: ['Potential Loyalists', 'New Audiences'],
        expected_roas: 2.8,
        priority_products: ['New brand products', 'Launch specials'],
        rationale: 'Visual storytelling για brand awareness'
      },
      {
        channel: 'YouTube Ads',
        budget: 3600,
        percentage: 20,
        target_segments: ['Broad Awareness', 'Interest-based'],
        expected_roas: 2.2,
        priority_products: ['Hero products', 'Brand story content'],
        rationale: 'Video-first brand introduction'
      },
      {
        channel: 'Influencer Marketing',
        budget: 3600,
        percentage: 20,
        target_segments: ['Niche audiences', 'Early adopters'],
        expected_roas: 3.5,
        priority_products: ['Seeding products', 'Review samples'],
        rationale: 'Authentic social proof για new brand'
      },
      {
        channel: 'Email Marketing',
        budget: 2700,
        percentage: 15,
        target_segments: ['Champions', 'Loyal'],
        expected_roas: 7.5,
        priority_products: ['VIP early access', 'Exclusive previews'],
        rationale: 'Leverage existing audience για launch buzz'
      },
      {
        channel: 'Google Display',
        budget: 2700,
        percentage: 15,
        target_segments: ['In-market audiences', 'Affinity groups'],
        expected_roas: 2.5,
        priority_products: ['Brand awareness creative', 'Launch messaging'],
        rationale: 'Broad reach για brand visibility'
      }
    ]
  },
  revenue_push: {
    total_budget: 20000,
    allocation: [
      {
        channel: 'Google Shopping (CSS)',
        budget: 6000,
        percentage: 30,
        target_segments: ['High-intent', 'Comparison shoppers'],
        expected_roas: 4.8,
        priority_products: ['Best sellers', 'Competitive pricing'],
        rationale: 'Capture bottom-funnel demand efficiently'
      },
      {
        channel: 'Meta Ads',
        budget: 5000,
        percentage: 25,
        target_segments: ['Potential Loyalists', 'Lookalikes'],
        expected_roas: 4.0,
        priority_products: ['Top performers', 'High-volume items'],
        rationale: 'Scale acquisition με proven performers'
      },
      {
        channel: 'Email Marketing',
        budget: 3000,
        percentage: 15,
        target_segments: ['Champions', 'Loyal', 'Potential'],
        expected_roas: 9.5,
        priority_products: ['Cross-sell recommendations', 'Bundles'],
        rationale: 'Maximize revenue from existing customers'
      },
      {
        channel: 'Remarketing',
        budget: 3000,
        percentage: 15,
        target_segments: ['All website visitors', 'Cart abandoners'],
        expected_roas: 6.0,
        priority_products: ['Abandoned items', 'Related products'],
        rationale: 'Recover lost revenue efficiently'
      },
      {
        channel: 'SMS/Push',
        budget: 3000,
        percentage: 15,
        target_segments: ['Champions', 'Loyal'],
        expected_roas: 7.2,
        priority_products: ['Flash sales', 'Limited offers'],
        rationale: 'Drive urgency για immediate revenue'
      }
    ]
  }
};

export const channelPerformanceHistory = [
  { month: 'Aug 2025', email: 8.2, google: 4.1, meta: 3.5, remarketing: 5.0, sms: 6.5 },
  { month: 'Sep 2025', email: 8.5, google: 4.3, meta: 3.7, remarketing: 5.2, sms: 6.8 },
  { month: 'Oct 2025', email: 8.8, google: 4.5, meta: 3.9, remarketing: 5.4, sms: 7.0 },
  { month: 'Nov 2025', email: 9.2, google: 4.6, meta: 4.0, remarketing: 5.5, sms: 7.2 },
  { month: 'Dec 2025', email: 9.8, google: 5.0, meta: 4.2, remarketing: 5.8, sms: 7.5 },
  { month: 'Jan 2026', email: 9.5, google: 4.8, meta: 4.0, remarketing: 5.5, sms: 7.0 }
];
