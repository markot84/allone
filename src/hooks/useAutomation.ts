import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBrand } from './useBrand';
import { AutomationSettingsService, AutomationAlertsService } from '../services/automationSettings';

export function useAutomationSettings() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const qc = useQueryClient();

  const { data: settings, isPending } = useQuery({
    queryKey: ['automation_settings', brandId],
    queryFn: () => (brandId ? AutomationSettingsService.get(brandId) : Promise.resolve(null)),
    enabled: !!brandId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation_settings', brandId] });

  return { settings: settings ?? null, isLoading: isPending, invalidate };
}

export function useAutomationAlerts() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const qc = useQueryClient();

  const { data: alerts = [], isPending } = useQuery({
    queryKey: ['automation_alerts', brandId],
    queryFn: () => (brandId ? AutomationAlertsService.getAll(brandId) : Promise.resolve([])),
    enabled: !!brandId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation_alerts', brandId] });

  const newAlerts = alerts.filter(a => a.status === 'new');

  return { alerts, newAlerts, isLoading: isPending, invalidate };
}
