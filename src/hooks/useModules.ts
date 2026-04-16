import { useMemo } from 'react';
import { getDefaultSectionForBrand, getModuleIdForSection, getModuleLabel, resolveEnabledModules } from '../config/modules';
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

  const brandType = currentBrand?.type ?? 'B2C';
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

  return {
    brandType,
    isB2B,
    enabledModules,
    moduleConfig,
    isSectionEnabled,
    getSectionLabel,
    getFallbackSection,
  };
}
