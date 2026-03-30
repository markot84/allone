// Auth & Brand Types
export type BrandPlan = 'growth' | 'enterprise';

export interface Brand {
  id: string;
  name: string;
  type: 'B2B' | 'B2C';
  plan?: BrandPlan;
  createdAt: string;
  createdBy: string;
  logoUrl?: string;
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

// Οργανικά οικονομικά στοιχεία επιχείρησης (τζίρος χωρίς campaigns)
export interface OrganicRevenue {
  id: string;
  period: string; // ISO date or "YYYY-MM" or "January 2025"
  organic_revenue: number; // τζίρος οργανικός (χωρίς έσοδα από campaigns)
  brandId?: string;
  createdAt?: Date | string;
  source?: string;
}

// Feed Source Types (for automated import)
export type FeedSourceType = 'erp' | 'google_ads' | 'meta_catalog';

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
  behavioral?: BehavioralProfile;
  predictive?: PredictiveMetrics;
}

export interface BehavioralProfile {
  preferred_channels: string[];
  purchase_frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'rare';
  avg_basket_size: number;
  peak_hours: string[];
  peak_days: string[];
  payment_method: string;
  device_preference: 'mobile' | 'desktop' | 'mixed';
  category_affinity: CategoryAffinity[];
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
  /** Target Days of Stock — ideal stock duration in days */
  tod: number;
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
  /** Supplier name — links to Supplier.name for TOD lookup */
  supplier?: string;
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

export interface BudgetAction {
  channel: string;
  type: 'increase' | 'decrease' | 'push' | 'pause' | 'maintain';
  reason: string;
  suggestedChange?: number;
}

export interface ChannelRecommendation {
  primary: string[];
  secondary: string[];
  budget_allocation: Record<string, number>;
  rationale: string;
  actions?: BudgetAction[];
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
  }>;
  conversionActions?: Record<string, {
    conversions: number;
    value: number;
  }>;
}

// ── Coordination System Types ───────────────────────────────────────────────

export type BrandMemberRole = 'owner' | 'admin' | 'member';
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
  quietHoursEnabled?: boolean;
  quietHoursStart?: string; // HH:mm
  quietHoursEnd?: string;   // HH:mm
  updatedAt?: string;
}

export const DEFAULT_NOTIFICATION_CHANNELS: Record<ActivityType, NotificationChannel[]> = {
  decision_created: ['inApp', 'email'],
  decision_updated: ['inApp'],
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
export type AlertStatus = 'new' | 'acknowledged' | 'acted' | 'dismissed';

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
