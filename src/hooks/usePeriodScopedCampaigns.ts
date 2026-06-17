import { useMemo } from 'react';
import type { Campaign } from '../types';
import {
  applyCampaignDateRangeToMetrics,
  filterCampaignsByScheduleDateOverlap,
} from '../utils/campaignDateRangeMetrics';

/** Campaigns scoped to period metrics — same logic as the Campaigns / ROI page (`campaignDateRangeMetrics`). */
export function usePeriodScopedCampaigns(
  campaigns: Campaign[] | undefined,
  periodDates: { fromDate: string; toDate: string }
): Campaign[] {
  return useMemo(() => {
    const list = campaigns ?? [];
    const { fromDate, toDate } = periodDates;
    const scheduleScoped = filterCampaignsByScheduleDateOverlap(list, fromDate, toDate);
    return applyCampaignDateRangeToMetrics(scheduleScoped, fromDate, toDate);
  }, [campaigns, periodDates.fromDate, periodDates.toDate]);
}
