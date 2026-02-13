// Auth & Brand Types
export interface Brand {
  id: string;
  name: string;
  type: 'B2B' | 'B2C';
  createdAt: string;
  createdBy: string;
  logoUrl?: string; // Firebase Storage URL for brand logo
  assets?: {
    logo?: string;
    images?: string[];
    documents?: string[];
  };
}

export interface UserProfile {
  id: string;
  email: string;
  displayName?: string;
  brandIds: string[];
  defaultBrandId?: string;
  createdAt: string;
}

export interface Invite {
  id: string;
  brandId: string;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
  usedAt?: string;
  createdBy?: string;
}

// Strategy Weights Types
export interface WeightFactor {
  id: string;
  name: string;
  icon: string;
  tooltip: string;
  color: string;
  value: number;
}

export interface Scenario {
  id: string;
  name: string;
  icon: string;
  description: string;
  weights: Record<string, number> | null;
}

// RFM Types
export interface RFMSegment {
  id: string;
  name: string;
  rfm_score: string;
  count: number;
  percentage: number;
  revenue_share: number;
  color: string;
  description: string;
  icon: string;
}

export interface CategoryAffinity {
  name: string;
  affinity: number;
  avg_order: number;
}

export interface SegmentCategoryData {
  categories: CategoryAffinity[];
  brands: string[];
  price_sensitivity: 'low' | 'medium' | 'high';
  preferred_channels: string[];
}

// Product Types (aligned with FINAL_Unified_Production_Schema)
export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  margin_tier: 'high' | 'medium' | 'low';
  margin_percentage: number;
  stock_level: number;
  stock_capacity: number;
  stock_age_days: number;
  priority_tag?: string;
  price: number;
  composite_score?: number;
  /** Cost price (Cost_Price in template) - optional */
  cost_price?: number;
  /** Revenue in period (Revenue_Period in template) - optional, used for revenue-based scoring */
  revenue_period?: number;
  /** Qty sold in period (Qty_Sold_Period in template) - optional */
  qty_sold_period?: number;
  /** First available date (First_Available_Date in template) - for Stock Age calc when Stock_Age_Days empty */
  first_available_date?: string;
  /** Firestore: when product was imported - fallback for Stock Age when no date column */
  createdAt?: { toDate: () => Date } | Date | string;
}

export interface InventorySummary {
  total_skus: number;
  total_value: number;
  healthy_stock: { count: number; percentage: number };
  excess_stock: { count: number; percentage: number; value: number };
  dead_stock: { count: number; percentage: number; value: number };
  low_stock: { count: number; percentage: number };
}

export interface InventoryAlert {
  type: 'critical' | 'warning' | 'info';
  message: string;
  action: string;
}

// Channel Types
export interface ChannelAllocation {
  channel: string;
  budget: number;
  percentage: number;
  target_segments: string[];
  expected_roas: number;
  priority_products: string[];
  rationale: string;
}

export interface ChannelRecommendation {
  primary: string[];
  secondary: string[];
  budget_allocation: Record<string, number>;
  rationale: string;
}

// Content Calendar Types
export interface ContentItem {
  week: number;
  topic: string;
  formats: string[];
  target_segments: string[];
  products_featured: string[];
  status: 'draft' | 'in_production' | 'published' | 'scheduled';
  performance?: {
    views: number;
    engagement: string;
    conversions: number;
  };
}

export interface ContentCalendar {
  month: string;
  theme: string;
  customer_journey_focus: string;
  content_items: ContentItem[];
}

// ROI Types
export interface ROIBreakdown {
  label: string;
  revenue: number;
  percentage: number;
  details: Record<string, unknown>[];
  cost_avoided?: number;
}

export interface ROISummary {
  period: string;
  total_revenue: number;
  performance_plus_attributed: number;
  attribution_percentage: number;
  roi_multiplier: number;
}

// AI Insights Types
export interface AIInsight {
  type: 'opportunity' | 'warning' | 'recommendation';
  icon: string;
  title: string;
  insight: string;
  action: string;
  impact: 'high' | 'medium' | 'low';
}

// Approval Types
export interface ApprovalStatus {
  label: string;
  color: string;
  icon: string;
}

// Navigation Types
export interface NavItem {
  id: string;
  name: string;
  icon: string;
  badge?: string;
}

// Dashboard KPI Types
export interface KPIData {
  label: string;
  value: string | number;
  change: number;
  changeLabel: string;
  trend: 'up' | 'down' | 'neutral';
  sparklineData?: number[];
}

// Campaign Types
export interface Campaign {
  id: string;
  name: string;
  channel: 'Google Ads' | 'Meta' | 'Other';
  period?: string; // Month or date range
  start_date?: string; // ISO date string
  end_date?: string; // ISO date string
  status?: string; // active, paused, completed, etc.
  budget?: number;
  amount_spent?: number;
  impressions?: number;
  clicks?: number;
  ctr?: number; // Click-through rate
  cpc?: number; // Cost per click
  cpm?: number; // Cost per 1,000 impressions
  conversions?: number;
  conversion_value?: number;
  roas?: number; // Return on ad spend
  cost_per_conversion?: number;
  conversion_rate?: number;
  currency_code?: string;
  bid_strategy_type?: string; // Google Ads specific
  result_type?: string; // Meta specific
  brandId?: string;
  createdAt?: Date | string;
  importedAt?: Date | string;
  source?: string; // Source file name
}
