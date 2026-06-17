import { useMemo } from 'react';
import {
  effectiveBrandTypeForModules,
  getDefaultSectionForBrand,
  getModuleIdForSection,
  getModuleLabel,
  getSectionFallbackAlias,
  resolveEnabledModules,
} from '../config/modules';
import type { AppSectionId, ModuleId } from '../types';
import { useBrand } from './useBrand';
import { usePlan } from './usePlan';

export interface ResolvedModuleConfig {
  id: ModuleId;
  enabled: boolean;
  label: string;
}

export function useModules() {
  const { currentBrand } = useBrand();
  const { canAccess } = usePlan();

  const brandType = effectiveBrandTypeForModules(currentBrand);
  const isB2B = brandType === 'B2B';

  const enabledModules = useMemo(
    () => resolveEnabledModules(currentBrand, { canAccess }),
    [canAccess, currentBrand]
  );

  const moduleConfig = useMemo(
    () =>
      Object.entries(enabledModules).reduce((acc, [id, enabled]) => {
        const moduleId = id as ModuleId;
        acc[moduleId] = {
          id: moduleId,
          enabled,
          label: getModuleLabel(moduleId, brandType),
        };
        return acc;
      }, {} as Record<ModuleId, ResolvedModuleConfig>),
    [brandType, enabledModules]
  );

  const isSectionEnabled = useMemo(
    () => (section: string) => {
      const moduleId = getModuleIdForSection(section);
      if (!moduleId) return true;
      return enabledModules[moduleId];
    },
    [enabledModules]
  );

  const getSectionLabel = useMemo(
    () => (section: string) => {
      const moduleId = getModuleIdForSection(section);
      if (!moduleId) return null;
      return moduleConfig[moduleId]?.label ?? null;
    },
    [moduleConfig]
  );

  const getFallbackSection = useMemo(
    () => (): AppSectionId => {
      const preferred = getDefaultSectionForBrand(brandType);
      if (isSectionEnabled(preferred)) return preferred;
      const firstEnabledModule = (Object.keys(enabledModules) as ModuleId[]).find((id) => enabledModules[id]);
      if (firstEnabledModule) return firstEnabledModule as AppSectionId;
      return 'dashboard';
    },
    [brandType, enabledModules, isSectionEnabled]
  );

  /** Resolves a requested section to an accessible one: itself if enabled,
   * else its alias (e.g. products → procurement), else the generic fallback. */
  const resolveAccessibleSection = useMemo(
    () => (section: string): AppSectionId => {
      if (isSectionEnabled(section)) return section as AppSectionId;
      const alias = getSectionFallbackAlias(section);
      if (alias && isSectionEnabled(alias)) return alias;
      return getFallbackSection();
    },
    [isSectionEnabled, getFallbackSection]
  );

  return {
    brandType,
    isB2B,
    enabledModules,
    moduleConfig,
    isSectionEnabled,
    getSectionLabel,
    getFallbackSection,
    resolveAccessibleSection,
  };
}
