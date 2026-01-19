// Strategy-to-Content Mapping
export const strategyContentMap = {
  profit_max: {
    id: 'profit_max',
    icon: '💰',
    name: 'Profit Maximization',
    content_tone: 'Aspirational, exclusive, premium',
    content_types: ['Brand stories', 'Expert guides', 'Quality comparisons'],
    channels: ['Email nurture', 'Blog/SEO', 'LinkedIn'],
    cta_style: 'Soft sell, relationship building',
    avoid: ['Heavy discounting', 'Urgency language', 'Mass market messaging'],
    sample_headlines: [
      'Η τέχνη πίσω από το [Product]',
      'Γιατί οι experts επιλέγουν [Brand]',
      '5 λόγοι που η ποιότητα κάνει τη διαφορά'
    ]
  },
  stock_clearance: {
    id: 'stock_clearance',
    icon: '📦',
    name: 'Stock Clearance',
    content_tone: 'Urgent, direct, deal-focused',
    content_types: ['Flash sales', 'Last chance alerts', 'Bundle offers'],
    channels: ['Email blasts', 'SMS', 'Paid social', 'Remarketing'],
    cta_style: 'Hard sell, urgency triggers',
    avoid: ['Long-form content', 'Brand storytelling', 'Educational pieces'],
    sample_headlines: [
      '⏰ Τελευταίες 48 ώρες: Έως -50%',
      'Αυτά τα deals δεν θα ξαναδείς',
      'Stock που φεύγει ΔΕΝ ξαναέρχεται'
    ]
  },
  brand_launch: {
    id: 'brand_launch',
    icon: '🚀',
    name: 'Brand Launch',
    content_tone: 'Exciting, innovative, exclusive access',
    content_types: ['Launch teasers', 'Unboxing content', 'Early access'],
    channels: ['Social organic', 'Email teasers', 'Influencer'],
    cta_style: 'Exclusive, early adopter benefits',
    avoid: ['Price focus', 'Comparison content', 'Generic messaging'],
    sample_headlines: [
      '🆕 Πρώτη φορά στην Ελλάδα',
      'Exclusive preview για τους [Segment]',
      'Be the first: [Brand] έρχεται'
    ]
  },
  revenue_push: {
    id: 'revenue_push',
    icon: '📈',
    name: 'Revenue Push',
    content_tone: 'Practical, value-driven, social proof',
    content_types: ['Best sellers', 'Reviews roundup', 'How-to guides'],
    channels: ['Google Shopping', 'Meta Ads', 'Email promos'],
    cta_style: 'Clear value, easy conversion',
    avoid: ['Premium positioning', 'Slow-burn content', 'Niche targeting'],
    sample_headlines: [
      'Τα 10 best sellers του μήνα',
      'Γιατί 5.000+ επέλεξαν το [Product]',
      'Ό,τι χρειάζεσαι για [Need] - από €X'
    ]
  }
};

// Active Strategy Context
export const activeStrategyContext = {
  name: 'Stock Clearance',
  id: 'stock_clearance',
  approved_by: 'Maria K. (Marketing Director)',
  approved_date: '2025-12-28',
  status: 'active' as const,
  valid_until: '2026-01-31',
  
  content_direction: {
    tone: 'Direct, time-sensitive, opportunity-driven',
    messaging_focus: 'Value deals, limited availability, urgency',
    product_emphasis: 'Excess stock, seasonal items, bundle deals',
    target_segments: ['At Risk', 'Potential Loyalists'],
    recommended_formats: ['Flash sale emails', 'SMS alerts', 'Social ads'],
    avoid: ['Long-form content', 'Brand storytelling', 'Educational pieces']
  }
};

// Content Items with Strategy Alignment
export const contentItems = [
  {
    id: 'cnt_001',
    title: 'New Year Flash Sale Announcement',
    type: 'Email Campaign',
    strategy_match: 'stock_clearance',
    is_aligned: true,
    segment: 'At Risk',
    status: 'published' as const,
    scheduled: '2026-01-02',
    products_featured: 45,
    week: 1,
    performance: { opens: 4523, clicks: 892, conversions: 145 }
  },
  {
    id: 'cnt_002',
    title: 'SMS: Last Chance Winter Items',
    type: 'SMS Campaign',
    strategy_match: 'stock_clearance',
    is_aligned: true,
    segment: 'Champions + Loyal',
    status: 'scheduled' as const,
    scheduled: '2026-01-08',
    products_featured: 28,
    week: 2
  },
  {
    id: 'cnt_003',
    title: 'Brand Story: Craftsmanship Excellence',
    type: 'Blog Post',
    strategy_match: 'profit_max',
    is_aligned: false,
    alignment_warning: 'Content type δεν ταιριάζει με Stock Clearance strategy',
    suggestion: 'Μετακίνηση σε επόμενο μήνα ή αναμονή αλλαγής strategy',
    segment: 'Champions',
    status: 'on_hold' as const,
    scheduled: '2026-01-10',
    products_featured: 5,
    week: 2
  },
  {
    id: 'cnt_004',
    title: 'Bundle Deals: Home Office Essentials',
    type: 'Landing Page',
    strategy_match: 'stock_clearance',
    is_aligned: true,
    segment: 'Potential Loyalists',
    status: 'in_production' as const,
    scheduled: '2026-01-12',
    products_featured: 15,
    week: 2
  },
  {
    id: 'cnt_005',
    title: 'Premium Guide: Audio Excellence',
    type: 'Blog Post',
    strategy_match: 'profit_max',
    is_aligned: false,
    alignment_warning: 'Long-form educational content not aligned with Stock Clearance',
    suggestion: 'Reschedule to Q2 when switching to Profit Max strategy',
    segment: 'Champions',
    status: 'on_hold' as const,
    scheduled: '2026-01-15',
    products_featured: 8,
    week: 3
  },
  {
    id: 'cnt_006',
    title: 'Flash Sale: Electronics Week',
    type: 'Email Series',
    strategy_match: 'stock_clearance',
    is_aligned: true,
    segment: 'At Risk + Potential',
    status: 'draft' as const,
    scheduled: '2026-01-15',
    products_featured: 67,
    week: 3
  },
  {
    id: 'cnt_007',
    title: 'Instagram Carousel: Clearance Picks',
    type: 'Social Post',
    strategy_match: 'stock_clearance',
    is_aligned: true,
    segment: 'All Segments',
    status: 'approved' as const,
    scheduled: '2026-01-16',
    products_featured: 10,
    week: 3
  },
  {
    id: 'cnt_008',
    title: 'Valentine\'s Gift Guide',
    type: 'Gift Guide',
    strategy_match: 'revenue_push',
    is_aligned: false,
    alignment_warning: 'Revenue push content may conflict with clearance messaging',
    suggestion: 'Consider focusing on clearance items as gift options',
    segment: 'All Segments',
    status: 'draft' as const,
    scheduled: '2026-01-20',
    products_featured: 25,
    week: 4
  },
  {
    id: 'cnt_009',
    title: 'Remarketing: Abandoned Carts Flash Offer',
    type: 'Display Ads',
    strategy_match: 'stock_clearance',
    is_aligned: true,
    segment: 'Cart Abandoners',
    status: 'scheduled' as const,
    scheduled: '2026-01-05',
    products_featured: 0,
    week: 1
  },
  {
    id: 'cnt_010',
    title: 'End of January Mega Sale',
    type: 'Multi-channel Campaign',
    strategy_match: 'stock_clearance',
    is_aligned: true,
    segment: 'All Segments',
    status: 'draft' as const,
    scheduled: '2026-01-25',
    products_featured: 120,
    week: 4
  }
];

// Content Approval Workflow Stages
export const contentApprovalFlow = [
  {
    stage: 'content_brief',
    label: 'Content Brief',
    description: 'AI generates brief based on strategy + segment',
    approver: 'Automatic',
    icon: '📋'
  },
  {
    stage: 'strategy_check',
    label: 'Strategy Alignment',
    description: 'Verify content matches active commercial strategy',
    approver: 'Marketing Manager',
    auto_flags: true,
    icon: '🎯'
  },
  {
    stage: 'content_creation',
    label: 'Content Creation',
    description: 'Editorial App generates content',
    approver: 'Automatic',
    icon: '✍️'
  },
  {
    stage: 'brand_review',
    label: 'Brand Compliance',
    description: 'Tone of voice, brand guidelines check',
    approver: 'Brand Manager',
    icon: '🎨'
  },
  {
    stage: 'commercial_approval',
    label: 'Commercial Approval',
    description: 'Final sign-off before publishing',
    approver: 'Marketing Director',
    icon: '✅'
  },
  {
    stage: 'scheduled',
    label: 'Scheduled',
    description: 'Content queued for publishing',
    approver: 'Automatic',
    icon: '📅'
  }
];

// Editorial App Actions
export const editorialActions = [
  {
    id: 'generate_brief',
    label: 'Generate Content Brief',
    icon: '📋',
    description: 'Δημιουργεί brief βάσει strategy + segment + products',
    output: 'Sends to Editorial App'
  },
  {
    id: 'request_article',
    label: 'Request Article',
    icon: '✍️',
    description: 'Opens Editorial App με pre-filled context',
    params: ['strategy', 'segment', 'products', 'tone']
  },
  {
    id: 'bulk_request',
    label: 'Bulk Content Request',
    icon: '📦',
    description: 'Request full content package για campaign',
    output: 'Article + Newsletter + Social + Ads'
  },
  {
    id: 'view_queue',
    label: 'View Content Queue',
    icon: '📊',
    description: 'Shows pending content from Editorial App',
    badge: 3
  }
];

// Pending Approvals
export const pendingApprovals = [
  {
    id: 'appr_001',
    type: 'strategy' as const,
    title: 'Q1 Strategy: Stock Clearance → Profit Max',
    submitted_by: 'George P.',
    submitted_date: '2026-01-15',
    impact: 'Affects 156 products, 4 scheduled campaigns',
    urgency: 'high' as const
  },
  {
    id: 'appr_002',
    type: 'content' as const,
    title: 'Flash Sale Email - Week 3',
    submitted_by: 'Editorial App',
    submitted_date: '2026-01-14',
    strategy_aligned: true,
    urgency: 'medium' as const
  },
  {
    id: 'appr_003',
    type: 'campaign' as const,
    title: 'Google Shopping Feed Update',
    submitted_by: 'System',
    submitted_date: '2026-01-14',
    products_affected: 234,
    urgency: 'low' as const
  },
  {
    id: 'appr_004',
    type: 'content' as const,
    title: 'SMS Campaign - Last Chance Winter',
    submitted_by: 'Maria K.',
    submitted_date: '2026-01-13',
    strategy_aligned: true,
    urgency: 'medium' as const
  },
  {
    id: 'appr_005',
    type: 'content' as const,
    title: 'Instagram Carousel - Clearance Picks',
    submitted_by: 'Editorial App',
    submitted_date: '2026-01-12',
    strategy_aligned: true,
    urgency: 'low' as const
  }
];

// Approval History
export const approvalHistory = [
  {
    date: '2025-12-28',
    type: 'strategy',
    action: 'Approved Stock Clearance for Q1',
    by: 'Maria K.',
    role: 'Marketing Director'
  },
  {
    date: '2025-12-27',
    type: 'content',
    action: 'Approved New Year Flash Sale campaign',
    by: 'George P.',
    role: 'Marketing Manager'
  },
  {
    date: '2025-12-26',
    type: 'campaign',
    action: 'Approved Google Shopping feed update',
    by: 'System',
    role: 'Automatic'
  },
  {
    date: '2025-12-24',
    type: 'content',
    action: 'Put on hold: Brand Story content (misaligned)',
    by: 'Maria K.',
    role: 'Marketing Director'
  },
  {
    date: '2025-12-20',
    type: 'strategy',
    action: 'Submitted Stock Clearance strategy for approval',
    by: 'George P.',
    role: 'Marketing Manager'
  }
];

// Strategy Change Impact Preview
export const strategyChangeImpact = {
  from: {
    id: 'stock_clearance',
    name: 'Stock Clearance',
    icon: '📦'
  },
  to: {
    id: 'profit_max',
    name: 'Profit Maximization',
    icon: '💰'
  },
  impacts: {
    products: {
      will_deprioritize: 145,
      will_prioritize: 89,
      samples: [
        { name: 'iPhone Cases', change: 'deprioritize' },
        { name: 'Premium Headphones', change: 'prioritize' },
        { name: 'Seasonal Decor', change: 'deprioritize' },
        { name: 'Dyson Products', change: 'prioritize' },
        { name: 'Clearance Electronics', change: 'deprioritize' }
      ]
    },
    content: {
      aligned: 2,
      needs_review: 5,
      on_hold: 3,
      affected_items: [
        { title: 'Flash Sale Email', status: 'will_pause', reason: 'Urgency tone not aligned' },
        { title: 'Premium Guide', status: 'will_activate', reason: 'Matches new direction' },
        { title: 'Bundle Deals LP', status: 'will_pause', reason: 'Clearance focus' },
        { title: 'Brand Story', status: 'will_activate', reason: 'Premium positioning' }
      ]
    },
    campaigns: {
      active: 4,
      will_pause: 2,
      will_adjust: 2
    },
    estimated_impact: {
      margin: '+12%',
      volume: '-8%',
      revenue: '+4%'
    }
  }
};
