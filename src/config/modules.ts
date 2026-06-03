import type { AppSectionId, Brand, ModuleId } from '../types';

/**
 * Όταν είναι false, όλα τα brands αντιμετωπίζονται ως B2C (π.χ. maintenance).
 * Ο τύπος B2B/B2C ορίζεται μόνο από Super Admin· νέα brands μένουν B2C.
 */
export const B2B_EDITION_ENABLED = true;

export type ModuleEditionStatus = 'core' | 'optional' | 'hidden';

export interface ModuleDefinition {
  id: ModuleId;
  label: string;
  b2bLabel?: string;
  b2bStatus: ModuleEditionStatus;
  b2cStatus: ModuleEditionStatus;
  /** Plan feature που ΑΠΑΙΤΕΙΤΑΙ για να εμφανιστεί το module (π.χ. 'procurement' → Enterprise only). */
  planFeature?: string;
  /**
   * Plan feature που, όταν είναι διαθέσιμο, ΚΡΥΒΕΙ το module (αντίστροφο του planFeature).
   * π.χ. το Product Intelligence χρειάζεται μόνο στο Growth (απόθεμα από ERP)· στο Enterprise τα
   * αποθέματα έρχονται από το Procurement, οπότε κρύβεται με `hideWhenFeature: 'procurement'`.
   */
  hideWhenFeature?: string;
}

export const APP_SECTIONS: AppSectionId[] = [
  'brands',
  'dashboard',
  'strategy',
  'policy-impact',
  'marketing-plan',
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

export const MODULE_DEFINITIONS: ModuleDefinition[] = [
  { id: 'dashboard', label: 'Dashboard', b2bLabel: 'Owner Dashboard', b2bStatus: 'core', b2cStatus: 'core' },
  { id: 'roi', label: 'ROI & Performance', b2bLabel: 'Revenue & ROI', b2bStatus: 'optional', b2cStatus: 'core' },
  { id: 'ecommerce', label: 'E-commerce', b2bStatus: 'hidden', b2cStatus: 'core' },
  /** RFM + Behavioral + Predictive — ίδια in-app λογική (behavioralEngine) για B2B/B2C. */
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

/**
 * Εναλλακτικό section όταν το ζητούμενο είναι κρυφό/απενεργοποιημένο, ώστε τα deep links να μην
 * πέφτουν σε γενικό fallback. π.χ. στο Enterprise το Product Intelligence (`products`) είναι κρυφό →
 * η πλοήγηση ανακατευθύνεται στο `procurement` (η αντίστοιχη οθόνη αποθέματος για enterprise).
 */
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

/** Τύπος brand για modules / ναβ — σέβεται το `B2B_EDITION_ENABLED`. */
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
    const editionStatus = getEditionStatus(def.id, brandType);
    // Κρυφά modules για την έκδοση (π.χ. B2B-only σε B2C) ποτέ ενεργά, ακόμη κι αν υπάρχει παλιό override στη Firestore
    if (editionStatus === 'hidden') {
      acc[def.id] = false;
      return acc;
    }
    // Κρύψιμο όταν είναι διαθέσιμο συγκεκριμένο plan feature (π.χ. Product Intelligence κρύβεται στο
    // Enterprise όπου το απόθεμα προέρχεται από το Procurement).
    if (def.hideWhenFeature && (options?.canAccess?.(def.hideWhenFeature) ?? false)) {
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
