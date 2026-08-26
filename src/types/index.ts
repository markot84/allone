// Auth, routing & module types
export type BrandPlan = 'growth' | 'enterprise';
export type ModuleId =
  | 'dashboard'
  | 'roi'
  | 'ecommerce'
  | 'rfm'
  | 'products'
  | 'suppliers'
  | 'procurement'
  | 'channels'
  | 'campaigns'
  | 'competitive'
  | 'analytics'
  | 'finances'
  | 'calendar'
  | 'reports'
  | 'insights'
  | 'data'
  | 'coordination'
  | 'automation'
  | 'sales'
  | 'accounts'
  | 'markets'
  | 'hr'
  | 'offers'
  | 'territories';
export type BrandModuleOverrides = Partial<Record<ModuleId, boolean>>;
export type AppSectionId =
  | 'brands'
  | 'brand-profile'
  | 'dashboard'
  | 'strategy'
  | 'policy-impact'
  | 'marketing-plan'
  | 'commercial-info'
  | 'calendar'
  | 'rfm'
  | 'products'
  | 'suppliers'
  | 'procurement'
  | 'channels'
  | 'campaigns'
  | 'competitive'
  | 'finances'
  | 'reports'
  | 'roi'
  | 'insights'
  | 'coordination'
  | 'automation'
  | 'analytics'
  | 'ecommerce'
  | 'sales'
  | 'accounts'
  | 'markets'
  | 'hr'
  | 'offers'
  | 'territories'
  | 'data'
  | 'data-products'
  | 'data-segments'
  | 'data-campaigns'
  | 'data-organic'
  | 'data-procurement'
  | 'invite'
  | 'concept'
  | 'help'
  | 'admin';

export interface Brand {
  id: string;
  name: string;
  type: 'B2B' | 'B2C';
  plan?: BrandPlan;
  enabledModules?: BrandModuleOverrides;
  brandProfile?: BrandProfile;
  createdAt: string;
  createdBy: string;
  logoUrl?: string;
  assets?: {
    logo?: string;
    images?: string[];
    documents?: string[];
  };
  /** Manual Firestore turnover outside online connections (physical stores, B2B, ERP invoices); shown on Finances. */
  enterpriseTurnoverEUR?: number;
  /** History cutoff (ISO YYYY-MM-DD): orders/GA4 daily older than this are clamped out of reads (deletes nothing in Firestore). */
  historyStartDate?: string;
  /** E-shop order filter for `ecommerce_summary`: `eshop_classified` (default, `direct_eshop` only) | `eshop_all` (all non-cancelled). Legacy `erp` reads as `eshop_classified`. */
  revenueSourceMode?: 'eshop_classified' | 'eshop_all' | 'erp';
  /** Source + dating for the Dashboard "Revenue Performance" chart + total-revenue KPI.
   *  Default when unset: e-shop by order date if an e-shop connector exists, else ERP by document date. */
  revenuePerformanceSource?: 'eshop_order_date' | 'erp_document_date';
  /** Authoritative source for the product catalog + stock (Product Intelligence).
   *  Default when unset: procurement for enterprise+procurement, else ERP if an ERP connector exists, else e-commerce. */
  stockSourceMode?: 'erp' | 'ecommerce' | 'procurement';
  /** Per-brand stock-health classification thresholds (Product Intelligence). Each falls back to the
   *  platform default when unset, so existing brands are unchanged until tuned. */
  inventoryThresholds?: {
    /** Sales window (days) the velocity figure represents. Default 30. */
    velocityWindowDays?: number;
    /** Days-of-cover at/below which stock is "low". Default 30. */
    lowDaysOfCover?: number;
    /** Days-of-cover above which stock is "excess". Default 120. */
    excessDaysOfCover?: number;
    /** Grace days after receipt before unsold stock counts as "dead". Default 60. */
    newStockGraceDays?: number;
    /** Days without sales after which stock counts as "dead" (PER-310). Default 60. */
    deadStockDays?: number;
    /** Brand-wide fallback supplier lead time (days), used when a supplier has no lead_time. Default 30. */
    defaultLeadTimeDays?: number;
    /** Brand-wide fallback Target Days of Stock, used when a supplier has no tod. Default 60. */
    defaultTod?: number;
    /** Reorder point as a multiple of the supplier lead time (1.5 = warn 50% before it runs out). Default 1.5. */
    reorderWarningMultiplier?: number;
    /** Send the weekly Monday reorder email (Low Stock grouped by supplier) to daily-digest recipients. Default false. */
    reorderEmailEnabled?: boolean;
  };
  /** PER-293 non-merchandise (services/vouchers/made-to-order): out of stock analytics, revenue kept; extends the built-in shipping/discount rule; unset = unchanged. */
  nonMerchandise?: {
    /** Exact category match (accent/case-insensitive), e.g. 'plejimo'. Not a substring. */
    categories?: string[];
    /** Product-name substring (accent/case-insensitive), e.g. 'Court Cards', 'Unstrung'. */
    nameContains?: string[];
  };
}

export type BrandArchetype =
  | 'ruler'
  | 'hero'
  | 'sage'
  | 'explorer'
  | 'creator'
  | 'caregiver'
  | 'everyman'
  | 'lover'
  | 'magician'
  | 'outlaw'
  | 'jester'
  | 'innocent';

export type BrandIcpPriceSensitivity = 'low' | 'medium' | 'high';

export interface BrandICP {
  id: string;
  name: string;
  description: string;
  needs: string;
  objections: string;
  preferredMessages: string;
  priceSensitivity: BrandIcpPriceSensitivity;
}

export interface BrandProfile {
  description: string;
  /** Primary archetype. Kept as `archetype` for backwards compatibility with existing saved profiles. */
  archetype: BrandArchetype | '';
  /** Optional complementary archetype used as a secondary tone/positioning influence. */
  secondaryArchetype?: BrandArchetype | '';
  toneOfVoice: string;
  icps: BrandICP[];
  updatedAt?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName?: string;
  role?: 'member' | 'admin' | 'superadmin';
  brandIds: string[];
  defaultBrandId?: string;
  createdAt: string;
}

export interface ChangelogEntry {
  id: string;
  version: string;
  date: string;
  title: string;
  changes: string[];
  createdBy: string;
  createdAt: string;
}

export interface Invite {
  id: string;
  brandId: string;
  email: string;
  role: string;
  department?: BrandDepartment;
  token: string;
  expiresAt: string;
  usedAt?: string;
  createdBy?: string;
}

// Organic business revenue (turnover excluding campaigns)
export interface OrganicRevenue {
  id: string;
  period: string; // ISO date or "YYYY-MM" or "January 2025"
  organic_revenue: number; // organic turnover (excluding campaign revenue)
  brandId?: string;
  createdAt?: Date | string;
  source?: string;
}

// Feed Source Types (for automated import)
export type FeedSourceType = 'erp' | 'google_ads' | 'meta_catalog' | 'skroutz';

export interface FeedSource {
  id: string;
  brandId: string;
  name: string;
  type: FeedSourceType;
  url: string;
  schedule?: string; // cron: "0 6 * * *" = daily 6:00
  lastRun?: string; // ISO
  lastStatus?: 'success' | 'failed';
  lastError?: string;
  lastImported?: number;
  createdAt: string;
  updatedAt: string;
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
  duration?: number | 'ongoing';
  /** Optional footer on the strategy card (if missing, computed from the weights). */
  cardHint?: string;
}

/** Predefined SKU filtering scenarios for Sales Optimization (sales_base). */
export type SalesBasePresetId =
  | 'all'
  | 'sold_last_30d'
  | 'sold_last_90d'
  | 'sold_lifetime'
  | 'fast_low_cover'
  | 'never_sold'
  | 'zero_last_7d'
  | 'zero_last_30d'
  | 'zero_last_90d'
  | 'stalled_7_vs_90'
  | 'cold_last_sale_30d';

/** Categorization source in Sales Optimization. */
export type SalesBaseCategorySource = 'product' | 'procurement';

/** Saved active-strategy field — which SKUs "count" in Sales Optimization (sales_base). */
export interface SalesBaseScope {
  preset: SalesBasePresetId;
  brandFilter: string;
  categoryFilter: string;
  search: string;
  /** null = everything matching the preset + text filters (dynamic). Otherwise an allowlist. */
  selectedProductIds: string[] | null;
  /** Categories excluded from the analysis (e.g. lifecycle status "made to order"). */
  excludedCategories?: string[];
  /** Category source: 'product' = from imported products, 'procurement' = from procurement_inventory. */
  categorySource?: SalesBaseCategorySource;
}

/** Scope filter for Profit Maximization: '' = no filter on that dimension. */
export interface ProfitMaxScope {
  brandFilter: string;
  subcategoryFilter: string;
  productTypeFilter: string;
}

/** Preset filter for the Price Benchmarking (GMC) strategy. */
export type PriceBenchmarkPresetId = 'below_market' | 'all_benchmarked';

export interface PriceBenchmarkStrategyScope {
  preset: PriceBenchmarkPresetId;
  brandFilter: string;
  categoryFilter: string;
  search: string;
  selectedProductIds: string[] | null;
}

// RFM Types
export interface SegmentCustomer {
  customerId: string;
  email?: string;
  recency?: number;
  frequency?: number;
  monetary?: number;
  rfmScore?: string;
}

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
  behavioral?: BehavioralProfile;
  predictive?: PredictiveMetrics;
  /** Customer-level rows for derived e-commerce segments; used for Ads/Email audience exports. */
  customers?: SegmentCustomer[];
}

export interface BehavioralProfile {
  preferred_channels: string[];
  purchase_frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'rare';
  avg_basket_size: number;
  peak_hours: string[];
  peak_days: string[];
  payment_method: string;
  device_preference: 'mobile' | 'desktop' | 'mixed';
  /** Legacy heuristic buckets (line/SKU) — used when catalog is missing. */
  category_affinity: CategoryAffinity[];
  /** Catalog-backed category (platform + ERP). */
  category_affinity_catalog?: CategoryAffinity[];
  brand_affinity?: CategoryAffinity[];
  /** Present only for brands with a configured product-type source. */
  product_type_affinity?: CategoryAffinity[];
  subcategory_affinity?: CategoryAffinity[];
  sku_affinity?: CategoryAffinity[];
  /** Percentage of line turnover matched to catalog (not line_fallback). */
  catalog_match?: {
    revenue_matched_pct: number;
    lines_matched_pct: number;
    lines_total: number;
    lines_matched: number;
  };
  upsell_score: number;
  cross_sell_score: number;
  price_sensitivity: 'low' | 'medium' | 'high';
  engagement_score: number;
  persona: string;
  lifecycle_stage: 'new' | 'active' | 'loyal' | 'declining' | 'dormant';
  communication_preferences: {
    channel: string;
    frequency: string;
    best_time: string;
  }[];
}

export interface PredictiveMetrics {
  estimated_ltv: number;
  ltv_confidence: number;
  churn_risk: number;
  churn_risk_label: 'low' | 'medium' | 'high' | 'critical';
  next_purchase_probability: number;
  days_to_next_purchase: number;
  predicted_next_order_value: number;
  revenue_forecast_30d: number;
  revenue_forecast_90d: number;
  demand_trend: 'growing' | 'stable' | 'declining';
  retention_score: number;
}

export interface CategoryAffinity {
  name: string;
  affinity: number;
  avg_order: number;
  /** Cumulative order-line revenue for this key (name/SKU/type). */
  revenue_eur?: number;
  /** Share of the segment's total turnover (%). */
  revenue_share_pct?: number;
  /** Operational stock snapshot from ERP/catalog, summed by unique SKU when available. */
  stock_on_hand?: number;
  /** Units sold from ERP/catalog period fields, summed by unique SKU when available. */
  qty_sold?: number;
  /** Merchandising path for SKU/category context (e.g. Category > Subcategory > SKU). */
  category_path?: string[];
}

export interface SegmentCategoryData {
  categories: CategoryAffinity[];
  brands: string[];
  price_sensitivity: 'low' | 'medium' | 'high';
  preferred_channels: string[];
}

// Supplier Types
export interface Supplier {
  id: string;
  name: string;
  /** Target Days of Stock — ideal stock duration in days; absent = platform default */
  tod?: number;
  /** Optional lead time in days */
  lead_time?: number;
  /** Optional contact info */
  contact?: string;
  /** Brand scope */
  brandId?: string;
}

// Product Types (aligned with FINAL_Unified_Production_Schema)
export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  /** Optional finer grouping from ERP exports. */
  subcategory?: string;
  margin_tier: 'high' | 'medium' | 'low';
  margin_percentage: number;
  stock_level: number;
  stock_capacity: number;
  /** Raw ERP stock snapshots when available. */
  stock_on_hand?: number;
  available_stock?: number;
  /** Days in stock / catalog — optional (e.g. procurement feed without an age column). */
  stock_age_days?: number;
  priority_tag?: string;
  price: number;
  /** Compare/list price from ERP when available. */
  compare_at_price?: number;
  list_price?: number;
  composite_score?: number;
  /** Cost price (Cost_Price in template) - optional */
  cost_price?: number;
  /** Revenue in period (Revenue_Period in template) - optional, used for revenue-based scoring */
  revenue_period?: number;
  /** Qty sold in period (Qty_Sold_Period in template) - optional */
  qty_sold_period?: number;
  /** Optional sales windows (import / connector) — Sales Optimization. */
  qty_sold_last_7d?: number;
  qty_sold_last_30d?: number;
  qty_sold_last_90d?: number;
  qty_sold_lifetime?: number;
  /** ISO or Excel date string — last recorded sale for the SKU */
  last_sale_at?: string;
  /** First available date (First_Available_Date in template) - for Stock Age calc when Stock_Age_Days empty */
  first_available_date?: string;
  /** Firestore: when product was imported - fallback for Stock Age when no date column */
  createdAt?: { toDate: () => Date } | Date | string;
  /** Supplier name — links to Supplier.name for TOD lookup */
  supplier?: string;
  /** Commercial brand (Brand column in import) — optional */
  brand?: string;
  /** Per-brand-configured product type (e.g. Clothes, Shoes). */
  product_type?: string;
  /** Product barcode / GTIN from ERP. */
  barcode?: string;
  gtin?: string;
  /** Product status from ERP (e.g. active/inactive/discontinued). */
  status?: string;
  /** Commercial classification fields from ERP. */
  abc_class?: string;
  flow_group?: string;
  product_segment?: string;
  seasonality_tag?: string;
  reorder_point?: number;
  reorder_qty?: number;
  /** From procurement_inventory.ΚΑΤΗΓΟΡΙΑ — commercial category in procurement */
  procurement_category?: string;
  /** From procurement_inventory.STATUS_ΚΩΔΙΚΟΥ or ΑΞΙΟΛΟΓΗΣΗ_ΕΙΔΟΥΣ — lifecycle status (e.g. "made to order", "to be discontinued") */
  procurement_status?: string;
}

export interface InventorySummary {
  total_skus: number;
  total_value: number;
  /** PER-317: δεσμευμένο κεφάλαιο (cost×stock); optional — absent on pre-317 aggregates. */
  total_cost_value?: number;
  healthy_stock: { count: number; percentage: number };
  excess_stock: { count: number; percentage: number; value: number; cost_value?: number };
  dead_stock: { count: number; percentage: number; value: number; cost_value?: number };
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

export interface BudgetAction {
  channel: string;
  type: 'increase' | 'decrease' | 'push' | 'pause' | 'maintain';
  reason: string;
  suggestedChange?: number;
}

/** AI-generated per-segment fit annotation for segments matching the commercial policy; shown as tabs in Channel Activation. */
export interface RecommendedSegment {
  /** Segment name as shown in RFM data (e.g. "Champions"). */
  name: string;
  /** Fit level against the strategy. */
  fit: 'ideal' | 'good';
  /** 1-2 reasons why it's chosen for this policy. */
  rationale: string;
}

/** AI-generated playbook entry per (segment, channel): `message` is owner-facing copy, `marketingBrief` is the detailed agency/execution brief. */
export interface ChannelPlaybookEntry {
  segment: string;
  channel: string;
  message: string;
  marketingBrief: string;
  /** Channel priority for this specific segment (differs from the global primary/secondary). */
  priority?: 'primary' | 'secondary';
  /** Suggested % budget FOR THE SEGMENT (sums to 100 per segment). */
  budgetSharePct?: number;
}

export interface ChannelRecommendation {
  primary: string[];
  secondary: string[];
  budget_allocation: Record<string, number>;
  rationale: string;
  actions?: BudgetAction[];
  /** Only the segments that match the chosen commercial policy. */
  targetSegments?: RecommendedSegment[];
  /** Per (segment, channel) campaign brief / marketing brief — AI-generated. */
  channelPlaybook?: ChannelPlaybookEntry[];
  /** Signature of Brand Profile prompt context used to generate customer-facing copy. */
  brandProfileContextSig?: string;
}

/** Extra marketing costs (agency, tools, one-off) — stored in the active strategy, used in ROI. */
export type MarketingCostLine =
  | {
      id: string;
      label: string;
      kind: 'fixed_monthly';
      amountEUR: number;
    }
  | {
      id: string;
      label: string;
      kind: 'percent_of_budget';
      percent: number;
    }
  | {
      id: string;
      label: string;
      kind: 'one_off_month';
      amountEUR: number;
      /** YYYY-MM */
      month: string;
    };

/** P&L cost line — monthly amount. */
export type PLCostLine = {
  id: string;
  label: string;
  /** Monthly cost in €. */
  amountEUR: number;
};

/** P&L cost category (e.g. "Fixed Costs", "Transportation"). */
export type PLCostCategory = {
  id: string;
  name: string;
  lines: PLCostLine[];
};

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

// ROI Types
export interface ROIBreakdown {
  label: string;
  revenue: number;
  percentage: number;
  details: Record<string, unknown>[];
  cost_avoided?: number;
}

export interface ROISummary {
  period?: string;
  total_revenue: number;
  performance_plus_attributed: number;
  attribution_percentage: number;
  roi_multiplier: number;
  campaign_cost: number;
}

// AI Insights Types
export interface AIInsight {
  type: 'opportunity' | 'warning' | 'recommendation';
  /** Stable id for navigation from the insights panel */
  insightKey?: string;
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
  is_active?: boolean; // true for current import, false for historical
  budget?: number;
  amount_spent?: number;
  impressions?: number;
  clicks?: number;
  ctr?: number; // Click-through rate
  cpc?: number; // Cost per click
  cpm?: number; // Cost per 1,000 impressions
  conversions?: number;
  conversion_value?: number;
  /** Google Ads: metrics with conversion_action_category PURCHASE (+ STORE_SALES). Meta: primary Purchase / Purchase (Pixel). */
  purchase_conversions?: number;
  purchase_conversion_value?: number;
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
  dailyMetrics?: Record<string, {
    impressions: number;
    clicks: number;
    conversions: number;
    amount_spent: number;
    conversion_value: number;
    purchase_conversions?: number;
    purchase_conversion_value?: number;
  }>;
  conversionActions?: Record<string, {
    conversions: number;
    value: number;
  }>;
  /** Meta only: purchase conversions/value per attribution window ('1d_click'..'28d_view') for window selection in reports. */
  metaWindows?: Record<string, { conversions: number; value: number }>;
  /** Geographic breakdown per country (Google geographic_view · Meta breakdowns=country) and optional byCity (keys `CC|Name`). */
  geo?: {
    byCountry: Record<string, {
      impressions: number;
      clicks: number;
      conversions: number;
      conversion_value: number;
      amount_spent: number;
    }>;
    byCity?: Record<string, {
      impressions: number;
      clicks: number;
      conversions: number;
      conversion_value: number;
      amount_spent: number;
    }>;
  };
}

export const META_ATTRIBUTION_WINDOWS = [
  '1d_click',
  '7d_click',
  '28d_click',
  '1d_view',
  '7d_view',
  '28d_view',
] as const;
export type MetaAttributionWindow = typeof META_ATTRIBUTION_WINDOWS[number] | 'default';

export const META_ATTRIBUTION_WINDOW_LABELS: Record<MetaAttributionWindow, string> = {
  default: 'Default (Account)',
  '1d_click': '1-day click',
  '7d_click': '7-day click',
  '28d_click': '28-day click',
  '1d_view': '1-day view',
  '7d_view': '7-day view',
  '28d_view': '28-day view',
};

// ── Coordination System Types ───────────────────────────────────────────────

export type BrandMemberRole = 'owner' | 'admin' | 'member';

export const ROLE_LABELS: Record<BrandMemberRole, string> = {
  owner: 'Ιδιοκτήτης',
  admin: 'Διαχειριστής',
  member: 'Μέλος',
};

/** Normalize a role from Firestore (legacy values, uppercase, whitespace). */
export function normalizeBrandMemberRole(raw: unknown): BrandMemberRole {
  if (raw == null) return 'member';
  const s = String(raw).trim().toLowerCase();
  if (s === 'owner' || s === 'admin' || s === 'member') return s;
  if (s === 'superadmin' || s === 'super_admin') return 'admin';
  return 'member';
}

export type BrandDepartment = 'management' | 'commercial' | 'marketing' | 'procurement' | 'agency' | 'external_partner' | 'other';

export const DEPARTMENT_LABELS: Record<BrandDepartment, string> = {
  management: 'Διοίκηση',
  commercial: 'Εμπορική Δ/νση',
  marketing: 'Marketing',
  procurement: 'Τμ. Προμηθειών',
  agency: 'Marketing Agency',
  external_partner: 'Εξωτερικός Συνεργάτης',
  other: 'Άλλο',
};

export interface BrandMember {
  id: string; // same as userId
  userId: string;
  email: string;
  displayName: string;
  role: BrandMemberRole;
  department: BrandDepartment;
  departmentLabel?: string;
  joinedAt: string;
}

export type DecisionCategory = 'pricing' | 'promotion' | 'product' | 'procurement' | 'marketing' | 'general';
export type DecisionPriority = 'low' | 'medium' | 'high' | 'urgent';
export type DecisionStatus = 'proposal' | 'draft' | 'active' | 'completed' | 'archived';

export interface Decision {
  id: string;
  brandId: string;
  title: string;
  description: string;
  category: DecisionCategory;
  priority: DecisionPriority;
  status: DecisionStatus;
  targetDepartments: BrandDepartment[];
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  taskCount: number;
}

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface CoordinationTask {
  id: string;
  brandId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedTo?: string;
  assignedToName?: string;
  assignedDepartment?: BrandDepartment;
  linkedDecisionId?: string;
  linkedDecisionTitle?: string;
  dueDate?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
}

export type CommentEntityType = 'decision' | 'task' | 'campaign' | 'strategy' | 'product';

export interface CoordinationComment {
  id: string;
  brandId: string;
  entityType: CommentEntityType;
  entityId: string;
  text: string;
  authorId: string;
  authorName: string;
  authorDepartment?: BrandDepartment;
  createdAt: string;
  mentions?: string[];
}

export type ActivityType =
  | 'decision_created' | 'decision_updated' | 'decision_completed'
  | 'task_created' | 'task_assigned' | 'task_completed'
  | 'comment_added' | 'member_joined';

export interface ActivityEntry {
  id: string;
  brandId: string;
  type: ActivityType;
  actorId: string;
  actorName: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
}

export interface UserNotification {
  id: string;
  brandId: string;
  type: ActivityType;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  read: boolean;
  createdAt: string;
}

export type NotificationChannel = 'inApp' | 'email';

export interface NotificationPreferences {
  userId: string;
  brandId: string;
  channels: Record<ActivityType, NotificationChannel[]>;
  /** Explicit opt-in for the brand's morning digest email. Default: false. */
  dailyDigestEmail?: boolean;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string; // HH:mm
  quietHoursEnd?: string;   // HH:mm
  updatedAt?: string;
}

export const DEFAULT_NOTIFICATION_CHANNELS: Record<ActivityType, NotificationChannel[]> = {
  decision_created: ['inApp', 'email'],
  /** Must include email: manual "notify departments", proposal approval, etc. */
  decision_updated: ['inApp', 'email'],
  decision_completed: ['inApp', 'email'],
  task_created: ['inApp', 'email'],
  task_assigned: ['inApp', 'email'],
  task_completed: ['inApp'],
  comment_added: ['inApp'],
  member_joined: ['inApp', 'email'],
};

// ── Automation ───────────────────────────────────────────────────────────────

export type TriggerPlanRequirement = 'growth' | 'enterprise';
export type AlertSeverity = 'info' | 'warning' | 'critical';
/** User evaluation before archiving — does not affect creation of new server-side alerts */
export type AlertEvaluation = 'urgent' | 'interested' | 'not_interested';
export type AlertStatus = 'new' | 'acknowledged' | 'acted' | 'dismissed' | 'archived';

export interface TriggerDefinition {
  id: string;
  label: string;
  description: string;
  group: string;
  planRequired: TriggerPlanRequirement;
  defaultThreshold?: number;
  thresholdLabel?: string;
  thresholdUnit?: string;
  defaultInterval: number;
}

export interface TriggerConfig {
  enabled: boolean;
  threshold?: number;
  checkIntervalDays: number;
  lastCheckedAt?: string;
  autoBriefing: boolean;
}

export interface AutomationSettings {
  triggers: Record<string, TriggerConfig>;
  updatedAt: string;
}

export interface AutomationAlert {
  id: string;
  brandId: string;
  triggerId: string;
  triggerLabel: string;
  triggerGroup?: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  suggestions: string[];
  status: AlertStatus;
  linkedDecisionId?: string;
  data: Record<string, unknown>;
  createdAt: string;
  evaluation?: AlertEvaluation;
  evaluatedAt?: string;
  evaluatedBy?: string;
}

// ─── E-commerce Types (Shopify / WooCommerce) ────────────────────

export interface OrderItem {
  sku: string;
  name: string;
  quantity: number;
  price: number;
  totalDiscount?: number;
  variantTitle?: string;
}

export interface Order {
  id: string;
  orderId: string;
  platform: 'shopify' | 'woocommerce';
  status: 'pending' | 'processing' | 'completed' | 'cancelled' | 'refunded' | string;
  customerEmail: string;
  customerName: string;
  items: OrderItem[];
  totalAmount: number;
  subtotalAmount?: number;
  totalTax?: number;
  totalShipping?: number;
  totalDiscount?: number;
  currency: string;
  createdAt: string;
  updatedAt?: string;
  shippingCity?: string;
  shippingCountry?: string;
  tags?: string[];
  brandId: string;
}

export interface EcomCustomer {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  ordersCount: number;
  totalSpent: number;
  currency: string;
  firstOrderAt?: string;
  lastOrderAt?: string;
  tags?: string[];
  platform: 'shopify' | 'woocommerce';
  brandId: string;
}

// ── HR Module Types ──────────────────────────────────────────────────────────

export type EmployeeStatus = 'active' | 'inactive' | 'on_leave';
export type LeaveType = 'annual' | 'sick' | 'other';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';

export interface HREmployee {
  id: string;
  brandId: string;
  name: string;
  role: string;
  department: string;
  monthlyCost: number;
  startDate: string;
  status: EmployeeStatus;
  email?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HRLeave {
  id: string;
  brandId: string;
  employeeId: string;
  employeeName: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  notes?: string;
  createdAt: string;
}

// ── Offer Builder Types ──────────────────────────────────────────────────────

export type OfferStatus = 'draft' | 'sent' | 'accepted' | 'rejected';

export interface OfferLineItem {
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  costPrice?: number;
}

export interface Offer {
  id: string;
  brandId: string;
  accountName: string;
  accountId?: string;
  date: string;
  validUntil?: string;
  status: OfferStatus;
  lines: OfferLineItem[];
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ── Territory / Rep Types ────────────────────────────────────────────────────

export interface TerritoryRep {
  id: string;
  brandId: string;
  name: string;
  email?: string;
  phone?: string;
  region: string;
  targetAccounts: number;
  createdAt: string;
}

export interface TerritoryAssignment {
  accountId: string;
  accountName: string;
  repId: string;
  repName: string;
  region: string;
  assignedAt: string;
}

export * from './budgetSuggestions';
