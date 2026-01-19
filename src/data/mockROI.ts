export const roiDashboard = {
  period: 'Last 90 Days',
  summary: {
    total_revenue: 847500,
    performance_plus_attributed: 312800,
    attribution_percentage: 36.9,
    roi_multiplier: 8.2
  },
  breakdown: {
    segment_activation: {
      label: 'Segment-Specific Campaigns',
      revenue: 156400,
      percentage: 50.0,
      details: [
        { segment: 'Champions Upsell', revenue: 67200, campaigns: 4 },
        { segment: 'At Risk Win-back', revenue: 45600, campaigns: 6 },
        { segment: 'Potential Loyalists Conversion', revenue: 43600, campaigns: 5 }
      ]
    },
    inventory_optimization: {
      label: 'Stock Clearance Revenue',
      revenue: 89200,
      percentage: 28.5,
      details: [
        { type: 'Excess Stock Sold', revenue: 62400, units: 1847 },
        { type: 'Dead Stock Recovered', revenue: 26800, units: 523 }
      ],
      cost_avoided: 34500
    },
    channel_optimization: {
      label: 'Channel Mix Improvements',
      revenue: 67200,
      percentage: 21.5,
      details: [
        { metric: 'ROAS Improvement', before: 3.2, after: 4.8, improvement: '+50%' },
        { metric: 'CPA Reduction', before: 24.50, after: 18.20, improvement: '-26%' },
        { metric: 'CSS Savings', value: 8400, description: 'Reduced CPC via Google CSS' }
      ]
    }
  }
};

export const roiCalculator = {
  subscription_cost_monthly: 1600,
  subscription_cost_period: 4800,
  revenue_attributed: 312800,
  roi_percentage: 6417,
  display: {
    headline: '64x ROI',
    subheadline: 'Κάθε €1 στο Performance+ απέφερε €64 σε attributed revenue',
    disclaimer: 'Βάσει conservative attribution methodology'
  }
};

export const roiMockData = {
  months: ['Aug 2025', 'Sep 2025', 'Oct 2025', 'Nov 2025', 'Dec 2025', 'Jan 2026'],
  total_revenue: [645000, 678000, 712000, 798000, 923000, 847500],
  attributed_revenue: [0, 45000, 112000, 187000, 267000, 312800],
  attribution_rate: [0, 6.6, 15.7, 23.4, 28.9, 36.9],
  milestones: [
    { month: 'Sep 2025', event: 'Performance+ Launch', type: 'start' },
    { month: 'Oct 2025', event: 'First RFM Segmentation', type: 'feature' },
    { month: 'Nov 2025', event: 'Stock Clearance Campaign', type: 'campaign' },
    { month: 'Dec 2025', event: 'Holiday Season + Optimization', type: 'peak' },
    { month: 'Jan 2026', event: 'Full System Maturity', type: 'milestone' }
  ]
};

export const segmentPerformance = [
  {
    segment: 'Champions',
    customers_targeted: 1247,
    campaigns_run: 8,
    revenue_generated: 156400,
    avg_order_value: 342,
    conversion_rate: '12.4%',
    vs_benchmark: '+45%'
  },
  {
    segment: 'Loyal',
    customers_targeted: 2341,
    campaigns_run: 6,
    revenue_generated: 98200,
    avg_order_value: 187,
    conversion_rate: '8.2%',
    vs_benchmark: '+32%'
  },
  {
    segment: 'Potential',
    customers_targeted: 1856,
    campaigns_run: 5,
    revenue_generated: 43600,
    avg_order_value: 124,
    conversion_rate: '5.6%',
    vs_benchmark: '+28%'
  },
  {
    segment: 'At Risk',
    customers_targeted: 1523,
    campaigns_run: 12,
    revenue_generated: 67800,
    avg_order_value: 89,
    conversion_rate: '4.8%',
    reactivation_rate: '18.2%',
    vs_benchmark: '+28%'
  },
  {
    segment: 'Lost',
    customers_targeted: 3067,
    campaigns_run: 4,
    revenue_generated: 12400,
    avg_order_value: 52,
    conversion_rate: '1.2%',
    vs_benchmark: '+15%'
  }
];

export const costSavings = {
  period: 'Last 90 Days',
  items: [
    {
      category: 'Warehousing Costs Avoided',
      amount: 34500,
      description: 'Dead stock clearance prevented storage fees',
      icon: '📦'
    },
    {
      category: 'Google CSS Savings',
      amount: 8400,
      description: 'Reduced CPC vs standard Shopping',
      icon: '🔍'
    },
    {
      category: 'Ad Spend Efficiency',
      amount: 12300,
      description: 'Better targeting = less wasted spend',
      icon: '🎯'
    },
    {
      category: 'Content Production',
      amount: 6800,
      description: 'AI content vs agency costs',
      icon: '✍️'
    }
  ],
  total: 62000
};

export const attributionMethodology = {
  title: 'Πώς υπολογίζουμε το Performance+ Impact',
  methods: [
    {
      name: 'Segment Campaign Attribution',
      description: 'Revenue από campaigns που στοχεύουν specific RFM segments identified by Performance+',
      tracking: 'UTM parameters + segment tags στο CRM',
      confidence: 'high'
    },
    {
      name: 'Product Prioritization Attribution',
      description: 'Revenue από προϊόντα που προωθήθηκαν βάσει του multi-factor scoring',
      tracking: 'Product IDs in prioritized feeds vs organic sales',
      confidence: 'high'
    },
    {
      name: 'Stock Clearance Attribution',
      description: 'Revenue από excess/dead stock που πουλήθηκε μέσω targeted campaigns',
      tracking: 'Stock age flag at time of sale',
      confidence: 'high'
    },
    {
      name: 'Channel Optimization Lift',
      description: 'Incremental ROAS improvement attributed to optimized channel mix',
      tracking: 'Before/after comparison με control period',
      confidence: 'medium'
    }
  ]
};
