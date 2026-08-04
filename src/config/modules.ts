import type { AppSectionId, Brand, ModuleId } from '../types';

/** When false, all brands are treated as B2C. B2B/B2C type is set only by Super Admin; new brands stay B2C.
 * Off for the Marketing & Data Analysis build: every B2B-only section is in `HIDDEN_SECTIONS`, so leaving
 * the edition on would only surface B2B labels and dashboard tiles pointing at hidden pages. */
export const B2B_EDITION_ENABLED = false;

export type ModuleEditionStatus = 'core' | 'optional' | 'hidden';

export interface ModuleDefinition {
  id: ModuleId;
  label: string;
  b2bLabel?: string;
  b2bStatus: ModuleEditionStatus;
  b2cStatus: ModuleEditionStatus;
  /** Plan feature REQUIRED for the module to appear (e.g. 'procurement' → Enterprise only). */
  planFeature?: string;
  /** Plan feature that, when available, HIDES the module (inverse of planFeature).
   * E.g. Product Intelligence hidden on Enterprise via `hideWhenFeature: 'procurement'`. */
  hideWhenFeature?: string;
}

export const APP_SECTIONS: AppSectionId[] = [
  'brands',
  'dashboard',
  'strategy',
  'policy-impact',
  'marketing-plan',
  'brand-profile',
  'commercial-info',
  'rfm',
  'products',
  'suppliers',
  'procurement',
  'channels',
  'campaigns',
  'competitive',
  'analytics',
  'ecommerce',
  'finances',
  'calendar',
  'reports',
  'roi',
  'insights',
  'data',
  'data-products',
  'data-segments',
  'data-campaigns',
  'data-organic',
  'data-procurement',
  'invite',
  'concept',
  'help',
  'admin',
  'coordination',
  'automation',
  'sales',
  'accounts',
  'markets',
  'hr',
  'offers',
  'territories',
];

/**
 * Sections switched off for the current build. NOTHING IS DELETED: every page, route, module
 * definition and nav entry below still exists and still compiles — they are only filtered out of
 * the nav, refused by `isSectionEnabled`, and redirected away from on deep links.
 *
 * To bring a section back, delete its id from this list. Nothing else needs changing: the nav item,
 * the dashboard tiles and the cross-links that point at it are all guarded by `isSectionHidden`,
 * so they reappear on their own.
 *
 * Kept visible: dashboard, rfm, competitive, strategy, campaigns, ecommerce, analytics,
 * brand-profile, calendar (Content Strategy), products, the whole data/* import flow,
 * plus brands, invite, help and admin.
 */
export const HIDDEN_SECTIONS: readonly AppSectionId[] = [
  'policy-impact',
  'marketing-plan',
  'commercial-info',
  'suppliers',
  'procurement',
  'channels',
  'finances',
  'reports',
  'roi',
  'insights',
  'concept',
  'coordination',
  'automation',
  'sales',
  'accounts',
  'markets',
  'hr',
  'offers',
  'territories',
];

/** Labels for the sections that have no module behind them, so the command palette can name them. */
const STANDALONE_SECTION_LABELS: Partial<Record<AppSectionId, string>> = {
  brands: 'My Brands',
  strategy: 'Commercial Strategy',
  'policy-impact': 'Policy Impact',
  'marketing-plan': 'Marketing Plan',
  'brand-profile': 'Brand Profile',
  'commercial-info': 'Εμπορικές Πληροφορίες',
  invite: 'Invite users',
  concept: 'Concept',
  help: 'Help',
  admin: 'Super Admin',
};

/** Display name for a section that `useModules().getSectionLabel` cannot resolve (no module). */
export function getSectionLabelForPalette(section: string): string {
  return STANDALONE_SECTION_LABELS[section as AppSectionId] ?? section;
}

const HIDDEN_SECTION_SET = new Set<string>(HIDDEN_SECTIONS);

/** True when the section is switched off for this build (see `HIDDEN_SECTIONS`). */
export function isSectionHidden(section: string): boolean {
  return HIDDEN_SECTION_SET.has(section);
}

export const MODULE_DEFINITIONS: ModuleDefinition[] = [
  { id: 'dashboard', label: 'Dashboard', b2bLabel: 'Owner Dashboard', b2bStatus: 'core', b2cStatus: 'core' },
  { id: 'roi', label: 'ROI & Performance', b2bLabel: 'Revenue & ROI', b2bStatus: 'optional', b2cStatus: 'core' },
  { id: 'ecommerce', label: 'E-commerce', b2bStatus: 'hidden', b2cStatus: 'core' },
  /** RFM + Behavioral + Predictive — same in-app logic (behavioralEngine) for B2B/B2C. */
  { id: 'rfm', label: 'Data Analysis', b2bStatus: 'core', b2cStatus: 'core' },
  { id: 'products', label: 'Product Intelligence', b2bLabel: 'Product Intelligence', b2bStatus: 'core', b2cStatus: 'core', hideWhenFeature: 'procurement' },
  { id: 'suppliers', label: 'Suppliers', b2bLabel: 'Supplier Management', b2bStatus: 'core', b2cStatus: 'optional' },
  { id: 'procurement', label: 'Procurement', b2bLabel: 'Procurement', b2bStatus: 'core', b2cStatus: 'optional', planFeature: 'procurement' },
  { id: 'channels', label: 'Channel Activation', b2bLabel: 'Sales Activation', b2bStatus: 'core', b2cStatus: 'core' },
  { id: 'campaigns', label: 'Campaigns', b2bLabel: 'Demand Generation', b2bStatus: 'core', b2cStatus: 'core' },
  { id: 'competitive', label: 'Competitive Intelligence', b2bLabel: 'Market Intelligence', b2bStatus: 'optional', b2cStatus: 'core' },
  { id: 'analytics', label: 'Web Analytics (GA4)', b2bLabel: 'Web Analytics', b2bStatus: 'optional', b2cStatus: 'core' },
  { id: 'finances', label: 'Finances', b2bLabel: 'Commercial Finance', b2bStatus: 'core', b2cStatus: 'core' },
  { id: 'calendar', label: 'Content Strategy', b2bLabel: 'Thought Leadership', b2bStatus: 'optional', b2cStatus: 'core' },
  { id: 'reports', label: 'Reports', b2bLabel: 'Owner Reports', b2bStatus: 'core', b2cStatus: 'core' },
  { id: 'insights', label: 'AI Insights', b2bLabel: 'AI Decision Support', b2bStatus: 'core', b2cStatus: 'core' },
  { id: 'data', label: 'Data Import', b2bLabel: 'Data Import', b2bStatus: 'core', b2cStatus: 'core' },
  { id: 'coordination', label: 'Department Coordination', b2bLabel: 'Commercial Coordination', b2bStatus: 'core', b2cStatus: 'core' },
  { id: 'automation', label: 'Automations', b2bLabel: 'Automations', b2bStatus: 'optional', b2cStatus: 'optional' },
  { id: 'sales', label: 'Sales Pipeline', b2bLabel: 'Sales Pipeline', b2bStatus: 'core', b2cStatus: 'hidden' },
  { id: 'accounts', label: 'Account Intelligence', b2bLabel: 'Account Intelligence', b2bStatus: 'core', b2cStatus: 'hidden' },
  { id: 'markets', label: 'Market Exploration', b2bLabel: 'Market Exploration', b2bStatus: 'core', b2cStatus: 'hidden' },
  { id: 'hr', label: 'People & HR', b2bLabel: 'People & HR', b2bStatus: 'core', b2cStatus: 'hidden' },
  { id: 'offers', label: 'Commercial Offers', b2bLabel: 'Commercial Offers', b2bStatus: 'core', b2cStatus: 'hidden' },
  { id: 'territories', label: 'Sales Territory', b2bLabel: 'Sales Territory', b2bStatus: 'core', b2cStatus: 'hidden' },
];

export const MODULE_DEFINITION_MAP = Object.fromEntries(
  MODULE_DEFINITIONS.map((moduleDef) => [moduleDef.id, moduleDef])
) as Record<ModuleId, ModuleDefinition>;

const SECTION_TO_MODULE: Partial<Record<AppSectionId, ModuleId>> = {
  dashboard: 'dashboard',
  rfm: 'rfm',
  products: 'products',
  suppliers: 'suppliers',
  procurement: 'procurement',
  channels: 'channels',
  campaigns: 'campaigns',
  competitive: 'competitive',
  analytics: 'analytics',
  ecommerce: 'ecommerce',
  finances: 'finances',
  calendar: 'calendar',
  reports: 'reports',
  roi: 'roi',
  insights: 'insights',
  data: 'data',
  'data-products': 'data',
  'data-segments': 'data',
  'data-campaigns': 'data',
  'data-organic': 'data',
  'data-procurement': 'data',
  coordination: 'coordination',
  automation: 'automation',
  sales: 'sales',
  accounts: 'accounts',
  markets: 'markets',
  hr: 'hr',
  offers: 'offers',
  territories: 'territories',
};

export function getModuleIdForSection(section: string): ModuleId | null {
  return SECTION_TO_MODULE[section as AppSectionId] ?? null;
}

/** Fallback section when the requested one is hidden, so deep links don't hit a generic default.
 * E.g. on Enterprise `products` is hidden → redirect to `procurement`. */
const SECTION_FALLBACK_ALIAS: Partial<Record<AppSectionId, AppSectionId>> = {
  products: 'procurement',
};

export function getSectionFallbackAlias(section: string): AppSectionId | null {
  return SECTION_FALLBACK_ALIAS[section as AppSectionId] ?? null;
}

export function getEditionStatus(moduleId: ModuleId, brandType: 'B2B' | 'B2C'): ModuleEditionStatus {
  const def = MODULE_DEFINITION_MAP[moduleId];
  return brandType === 'B2B' ? def.b2bStatus : def.b2cStatus;
}

export function getModuleLabel(moduleId: ModuleId, brandType: 'B2B' | 'B2C'): string {
  const def = MODULE_DEFINITION_MAP[moduleId];
  return brandType === 'B2B' ? def.b2bLabel ?? def.label : def.label;
}

export function getDefaultModuleEnabled(moduleId: ModuleId, brandType: 'B2B' | 'B2C'): boolean {
  return getEditionStatus(moduleId, brandType) !== 'hidden';
}

/** Brand type for modules / nav — respects `B2B_EDITION_ENABLED`. */
export function effectiveBrandTypeForModules(brand: Pick<Brand, 'type'> | null): 'B2B' | 'B2C' {
  if (!B2B_EDITION_ENABLED) return 'B2C';
  return brand?.type ?? 'B2C';
}

export function resolveEnabledModules(
  brand: Pick<Brand, 'type' | 'enabledModules'> | null,
  options?: { canAccess?: (feature: string) => boolean }
): Record<ModuleId, boolean> {
  const brandType = effectiveBrandTypeForModules(brand);
  const overrides = brand?.enabledModules ?? {};

  return MODULE_DEFINITIONS.reduce((acc, def) => {
    // Switched off for this build — outranks brand overrides and plan features alike.
    if (isSectionHidden(def.id)) {
      acc[def.id] = false;
      return acc;
    }
    const editionStatus = getEditionStatus(def.id, brandType);
    // Modules hidden for the edition (e.g. B2B-only on B2C) are never enabled, even if an old override exists in Firestore
    if (editionStatus === 'hidden') {
      acc[def.id] = false;
      return acc;
    }
    // Hide when a specific plan feature is available (e.g. Product Intelligence hidden on Enterprise).
    // Skipped when the module that feature unlocks is itself hidden (procurement is), otherwise the
    // swap would leave the brand with neither page.
    if (
      def.hideWhenFeature &&
      !isSectionHidden(def.hideWhenFeature) &&
      (options?.canAccess?.(def.hideWhenFeature) ?? false)
    ) {
      acc[def.id] = false;
      return acc;
    }
    const baseEnabled = overrides[def.id] ?? getDefaultModuleEnabled(def.id, brandType);
    const planAllowed = def.planFeature ? options?.canAccess?.(def.planFeature) ?? false : true;
    acc[def.id] = Boolean(baseEnabled && planAllowed);
    return acc;
  }, {} as Record<ModuleId, boolean>);
}

export function getDefaultSectionForBrand(brandType: 'B2B' | 'B2C'): AppSectionId {
  return brandType === 'B2B' ? 'dashboard' : 'dashboard';
}
