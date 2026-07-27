import type { RFMSegment, SegmentCategoryData } from '../types';

export const rfmSegments: RFMSegment[] = [
  {
    id: 'champions',
    name: 'Champions',
    rfm_score: '5-5-5 to 4-4-4',
    count: 1247,
    percentage: 12.4,
    revenue_share: 38.2,
    color: '#F59E0B',
    description: 'Υψηλή αξία, πρόσφατες αγορές, συχνοί αγοραστές',
    icon: ''
  },
  {
    id: 'loyal',
    name: 'Loyal Customers',
    rfm_score: '4-4-3 to 3-3-3',
    count: 2341,
    percentage: 23.3,
    revenue_share: 28.5,
    color: '#1D4ED8',
    description: 'Σταθερή αγοραστική συμπεριφορά',
    icon: ''
  },
  {
    id: 'potential',
    name: 'Potential Loyalists',
    rfm_score: '4-2-3 to 3-2-2',
    count: 1856,
    percentage: 18.5,
    revenue_share: 15.2,
    color: '#6366F1',
    description: 'Πρόσφατοι με δυναμική ανάπτυξης',
    icon: ''
  },
  {
    id: 'at_risk',
    name: 'At Risk',
    rfm_score: '2-3-3 to 2-2-2',
    count: 1523,
    percentage: 15.2,
    revenue_share: 10.8,
    color: '#EF4444',
    description: 'Μειωμένη δραστηριότητα, κίνδυνος απώλειας',
    icon: ''
  },
  {
    id: 'lost',
    name: 'Lost',
    rfm_score: '1-1-2 to 1-1-1',
    count: 3067,
    percentage: 30.6,
    revenue_share: 7.3,
    color: '#991B1B',
    description: 'Αδρανείς για μεγάλο χρονικό διάστημα',
    icon: ''
  }
];

export const segmentCategoryMatrix: Record<string, SegmentCategoryData> = {
  champions: {
    categories: [
      { name: 'Premium Electronics', affinity: 0.85, avg_order: 342 },
      { name: 'Home & Living', affinity: 0.72, avg_order: 156 },
      { name: 'Fashion Accessories', affinity: 0.68, avg_order: 89 },
      { name: 'Beauty & Wellness', affinity: 0.62, avg_order: 78 },
      { name: 'Computing', affinity: 0.58, avg_order: 425 }
    ],
    brands: ['Apple', 'Dyson', 'Samsung', 'Sony', 'Bose'],
    price_sensitivity: 'low',
    preferred_channels: ['Email', 'App Push', 'Loyalty Programs']
  },
  loyal: {
    categories: [
      { name: 'Home Appliances', affinity: 0.76, avg_order: 198 },
      { name: 'Mobile & Tablets', affinity: 0.71, avg_order: 312 },
      { name: 'Sports & Outdoors', affinity: 0.65, avg_order: 87 },
      { name: 'Kids & Baby', affinity: 0.59, avg_order: 64 },
      { name: 'Garden & DIY', affinity: 0.54, avg_order: 92 }
    ],
    brands: ['LG', 'Philips', 'Xiaomi', 'Nike', 'Adidas'],
    price_sensitivity: 'medium',
    preferred_channels: ['Email', 'Remarketing', 'Social']
  },
  potential: {
    categories: [
      { name: 'Fashion Accessories', affinity: 0.78, avg_order: 67 },
      { name: 'Beauty & Wellness', affinity: 0.74, avg_order: 52 },
      { name: 'Sports & Outdoors', affinity: 0.68, avg_order: 78 },
      { name: 'Consumables', affinity: 0.62, avg_order: 34 },
      { name: 'Home & Living', affinity: 0.55, avg_order: 89 }
    ],
    brands: ['Zara Home', 'H&M', 'Decathlon', 'The Body Shop'],
    price_sensitivity: 'medium',
    preferred_channels: ['Meta Ads', 'Google Shopping', 'Email']
  },
  at_risk: {
    categories: [
      { name: 'Consumables', affinity: 0.78, avg_order: 45 },
      { name: 'Basic Electronics', affinity: 0.62, avg_order: 67 },
      { name: 'Sports & Outdoors', affinity: 0.55, avg_order: 52 },
      { name: 'Automotive', affinity: 0.48, avg_order: 78 },
      { name: 'Garden & DIY', affinity: 0.42, avg_order: 56 }
    ],
    brands: ['Generic', 'Mid-tier brands', 'Private Label'],
    price_sensitivity: 'high',
    preferred_channels: ['SMS', 'Remarketing', 'Email Win-back']
  },
  lost: {
    categories: [
      { name: 'Consumables', affinity: 0.65, avg_order: 28 },
      { name: 'Garden & DIY', affinity: 0.52, avg_order: 45 },
      { name: 'Automotive', affinity: 0.48, avg_order: 62 },
      { name: 'Kids & Baby', affinity: 0.42, avg_order: 38 },
      { name: 'Home & Living', affinity: 0.35, avg_order: 54 }
    ],
    brands: ['Value brands', 'Private Label'],
    price_sensitivity: 'high',
    preferred_channels: ['Remarketing', 'Display', 'Email (Low frequency)']
  }
};

export const segmentMigration = {
  period: 'Last 30 Days',
  flows: [
    { from: 'loyal', to: 'champions', count: 156, percentage: 6.7 },
    { from: 'potential', to: 'loyal', count: 234, percentage: 12.6 },
    { from: 'loyal', to: 'at_risk', count: 89, percentage: 3.8 },
    { from: 'at_risk', to: 'lost', count: 178, percentage: 11.7 },
    { from: 'at_risk', to: 'potential', count: 67, percentage: 4.4 },
    { from: 'lost', to: 'at_risk', count: 45, percentage: 1.5 },
    { from: 'potential', to: 'at_risk', count: 112, percentage: 6.0 },
    { from: 'champions', to: 'loyal', count: 34, percentage: 2.7 }
  ]
};

export const totalCustomers = 10034;
