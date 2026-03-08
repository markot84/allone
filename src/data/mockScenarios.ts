import type { Scenario, WeightFactor, ChannelRecommendation } from '../types';

export const scenarios: Scenario[] = [
  { 
    id: 'profit_max', 
    name: 'Profit Maximization', 
    icon: '',
    description: 'Μεγιστοποίηση κερδοφορίας',
    weights: { profit: 40, stock: 15, strategic: 15, revenue: 10, fit: 20 },
    duration: 'ongoing' as const
  },
  { 
    id: 'stock_clearance', 
    name: 'Stock Clearance', 
    icon: '',
    description: 'Εκκαθάριση αποθέματος',
    weights: { profit: 15, stock: 45, strategic: 10, revenue: 10, fit: 20 },
    duration: 30
  },
  { 
    id: 'brand_launch', 
    name: 'Brand Launch', 
    icon: '',
    description: 'Λανσάρισμα νέου brand/προϊόντος',
    weights: { profit: 10, stock: 10, strategic: 50, revenue: 10, fit: 20 },
    duration: 60
  },
  { 
    id: 'revenue_push', 
    name: 'Revenue Push', 
    icon: '',
    description: 'Αύξηση τζίρου',
    weights: { profit: 15, stock: 15, strategic: 15, revenue: 35, fit: 20 },
    duration: 90
  },
  { 
    id: 'mixed', 
    name: 'Μικτή Στρατηγική', 
    icon: '',
    description: 'Συνδυασμός 2 στρατηγικών με ποσοστά',
    weights: null,
    duration: 'ongoing' as const
  },
  { 
    id: 'custom', 
    name: 'Custom', 
    icon: '',
    description: 'Προσαρμοσμένη στρατηγική',
    weights: null,
    duration: 'ongoing' as const
  }
];

export const defaultWeights: Record<string, number> = {
  profit: 20,
  stock: 20,
  strategic: 20,
  revenue: 20,
  fit: 20
};

export const weightFactors: Omit<WeightFactor, 'value'>[] = [
  { 
    id: 'profit', 
    name: 'Profitability', 
    icon: '',
    tooltip: 'Gross/net margin ανά προϊόν',
    color: '#22C55E'
  },
  { 
    id: 'stock', 
    name: 'Inventory Optimization', 
    icon: '',
    tooltip: 'Stock levels, age, excess inventory',
    color: '#3B82F6'
  },
  { 
    id: 'strategic', 
    name: 'Strategic Priority', 
    icon: '',
    tooltip: 'Brand push, new launches, supplier deals',
    color: '#8B5CF6'
  },
  { 
    id: 'revenue', 
    name: 'Revenue Targets', 
    icon: '',
    tooltip: 'Volume/revenue goals ανά category',
    color: '#F59E0B'
  },
  { 
    id: 'fit', 
    name: 'Customer Fit', 
    icon: '',
    tooltip: 'Segment affinity, purchase history',
    color: '#F97316'
  }
];

export const channelRecommendations: Record<string, Record<string, ChannelRecommendation>> = {
  profit_max: {
    champions: {
      primary: ['Email Marketing', 'Loyalty Programs'],
      secondary: ['Remarketing Display'],
      budget_allocation: { email: 40, loyalty: 35, display: 25 },
      rationale: 'High-value segment με proven purchase intent. Focus σε retention και upselling.'
    },
    loyal: {
      primary: ['Email Sequences', 'App Push'],
      secondary: ['Social Organic', 'Remarketing'],
      budget_allocation: { email: 45, push: 30, social: 15, remarketing: 10 },
      rationale: 'Maintain engagement με personalized recommendations για cross-sell.'
    },
    potential: {
      primary: ['Email Nurture', 'Meta Ads'],
      secondary: ['Google Shopping'],
      budget_allocation: { email: 35, meta: 40, google: 25 },
      rationale: 'Convert potential με targeted offers και social proof.'
    },
    at_risk: {
      primary: ['Email Win-back', 'Remarketing'],
      secondary: ['SMS Offers'],
      budget_allocation: { email: 50, remarketing: 30, sms: 20 },
      rationale: 'Aggressive re-engagement με time-sensitive offers.'
    },
    lost: {
      primary: ['Remarketing Display'],
      secondary: ['Email (Low frequency)'],
      budget_allocation: { remarketing: 70, email: 30 },
      rationale: 'Low-cost awareness maintenance, minimal investment.'
    }
  },
  stock_clearance: {
    champions: {
      primary: ['Email Flash Sales', 'App Push Notifications'],
      secondary: ['Social Organic'],
      budget_allocation: { email: 45, push: 35, social: 20 },
      rationale: 'Leverage loyalty για γρήγορο stock movement.'
    },
    loyal: {
      primary: ['Email Exclusive Access', 'SMS Flash'],
      secondary: ['App Push'],
      budget_allocation: { email: 50, sms: 30, push: 20 },
      rationale: 'Early access incentives για loyal base.'
    },
    potential: {
      primary: ['Google Shopping', 'Meta Ads'],
      secondary: ['Email Sequences'],
      budget_allocation: { google: 40, meta: 35, email: 25 },
      rationale: 'Acquisition focus με value-driven messaging.'
    },
    at_risk: {
      primary: ['Remarketing Display', 'Email Deals'],
      secondary: ['SMS'],
      budget_allocation: { remarketing: 45, email: 35, sms: 20 },
      rationale: 'Deep discounts για re-activation.'
    },
    lost: {
      primary: ['Display Ads', 'Google Shopping'],
      secondary: ['Email'],
      budget_allocation: { display: 50, google: 35, email: 15 },
      rationale: 'Broad reach με aggressive pricing.'
    }
  },
  brand_launch: {
    champions: {
      primary: ['Email VIP Preview', 'App Exclusive'],
      secondary: ['Influencer Seeding'],
      budget_allocation: { email: 40, app: 35, influencer: 25 },
      rationale: 'Early access builds anticipation και word-of-mouth.'
    },
    loyal: {
      primary: ['Email Launch Announcement', 'Social Teaser'],
      secondary: ['App Push'],
      budget_allocation: { email: 45, social: 35, push: 20 },
      rationale: 'Build excitement within engaged base.'
    },
    potential: {
      primary: ['Meta Awareness', 'YouTube Ads'],
      secondary: ['Google Display'],
      budget_allocation: { meta: 45, youtube: 35, google: 20 },
      rationale: 'Broad awareness για new brand recognition.'
    },
    at_risk: {
      primary: ['Email Re-engagement', 'Social Ads'],
      secondary: ['Remarketing'],
      budget_allocation: { email: 40, social: 40, remarketing: 20 },
      rationale: 'New brand as re-engagement hook.'
    },
    lost: {
      primary: ['Display Awareness', 'Social Reach'],
      secondary: ['Email'],
      budget_allocation: { display: 50, social: 35, email: 15 },
      rationale: 'Brand refresh opportunity.'
    }
  },
  revenue_push: {
    champions: {
      primary: ['Email Premium Bundles', 'Loyalty Upsell'],
      secondary: ['App Personalized'],
      budget_allocation: { email: 40, loyalty: 35, app: 25 },
      rationale: 'High AOV focus με premium recommendations.'
    },
    loyal: {
      primary: ['Email Cross-sell', 'Google Shopping'],
      secondary: ['Meta Dynamic'],
      budget_allocation: { email: 40, google: 35, meta: 25 },
      rationale: 'Volume push με category expansion.'
    },
    potential: {
      primary: ['Google Shopping', 'Meta Conversion'],
      secondary: ['Email Sequences'],
      budget_allocation: { google: 45, meta: 35, email: 20 },
      rationale: 'Aggressive acquisition για volume goals.'
    },
    at_risk: {
      primary: ['Remarketing', 'Email Incentives'],
      secondary: ['SMS Flash'],
      budget_allocation: { remarketing: 45, email: 35, sms: 20 },
      rationale: 'Incentive-driven reactivation για quick revenue.'
    },
    lost: {
      primary: ['Google Shopping', 'Display'],
      secondary: ['Email'],
      budget_allocation: { google: 50, display: 35, email: 15 },
      rationale: 'Volume-focused broad targeting.'
    }
  }
};

export const approvalStatuses = {
  draft: { label: 'Draft', color: 'gray', icon: '📝' },
  pending_review: { label: 'Pending Review', color: 'orange', icon: '⏳' },
  approved: { label: 'Approved', color: 'green', icon: '✅' },
  implementing: { label: 'In Implementation', color: 'blue', icon: '🚀' }
};
