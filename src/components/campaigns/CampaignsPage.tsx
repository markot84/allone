import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { TrendingUp, Filter, Download, Search, DollarSign, Trash2, ArrowUp, ArrowDown, ArrowUpDown, Wallet } from 'lucide-react';
import { Card, CardHeader, Badge, Button, Spinner, useToast, Tooltip, AlertsBanner, PageHeader, MetaAttributionSelector } from '../common';
import { CampaignsGeoTab } from './CampaignsGeoTab';
import { DateRangePicker } from '../ui/DateRangePicker';
import { useCampaigns } from '../../hooks/useCampaigns';
import { useBrand } from '../../hooks/useBrand';
import { useAuth } from '../../hooks/useAuth';
import { useGlobalDate } from '../../contexts/GlobalDateContext';
import { useSearchIntelligence } from '../../hooks/useSearchIntelligence';
import { FirestoreService } from '../../services/firestore';
import { formatCurrency, formatNumber, formatMultiplier, formatPercent } from '../../utils/format';
import { BudgetOpportunitySection } from '../roi/BudgetOpportunitySection';
import { CampaignsChannelInsights } from './CampaignsChannelInsights';
import { ChannelPerformanceHistoryCard } from './ChannelPerformanceHistoryCard';
import {
  getDisplayConversionValue,
  getDisplayConversions,
  getMetaPrimaryPurchaseFromActions,
  isGoogleAdsLikeChannel,
  isMetaChannel,
} from '../../utils/roiUtils';
import {
  applyCampaignDateRangeToMetrics,
  filterCampaignsByScheduleDateOverlap,
} from '../../utils/campaignDateRangeMetrics';
import type { Campaign } from '../../types';
import { sanitizeSpreadsheetCell } from '../../utils/spreadsheetSafe';

/** Euro sign as ASCII-safe escape (avoids mojibake if source encoding drifts). */
const EUR = '\u20AC';

/** PMax / store-visit campaigns: GA may label the action as Purchase with ~1 EUR per conversion. */
function isPhantomStoreVisitPurchaseRow(
  actionName: string,
  row: { conversions?: number; value?: number },
  campaignName?: string
): boolean {
  const conv = row.conversions ?? 0;
  const val = row.value ?? 0;
  const avgPerConv = conv > 0 ? val / conv : val;

  const cn = (campaignName || '').toLowerCase();
  if (
    (/store\s*visits?|shop\s*visits?/i.test(cn) || (/visit/i.test(cn) && /store|shop/i.test(cn))) &&
    avgPerConv >= 0.99 &&
    avgPerConv <= 1.01
  ) {
    return true;
  }

  if (val < 0.99 || val > 1.01) return false;
  const n = actionName.toLowerCase();
  if (/store\s*visits?|shop\s*visits?/i.test(n)) return true;
  if (/visit/i.test(n) && /store|shop/i.test(n)) return true;
  const gEp = '\u03b5\u03c0\u03af\u03c3\u03ba\u03b5\u03c8\u03b7';
  const gEp2 = '\u03b5\u03c0\u03b9\u03c3\u03ba\u03b5\u03c8\u03b7';
  const gKat = '\u03ba\u03b1\u03c4\u03ac\u03c3\u03c4\u03b7\u03bc\u03b1';
  const gKat2 = '\u03ba\u03b1\u03c4\u03b1\u03c3\u03c4\u03b7\u03bc\u03b1';
  if ((n.includes(gEp) || n.includes(gEp2)) && (n.includes(gKat) || n.includes(gKat2))) return true;
  return false;
}

function isGoogleAnalyticsImportLabel(name: string): boolean {
  const n = name.toLowerCase();
  if (/imported?\s+from\s+google\s+analytics/.test(n)) return true;
  if (/from\s+google\s+analytics/.test(n)) return true;
  if (/\bgoogle\s+analytics\s*(\(4\)|4)?\b/.test(n)) return true;
  if (/\bga4\b/.test(n)) return true;
  if (/\bga\s*\(?4\)?\b/.test(n)) return true;
  if (/import.*\b(ga4|google\s+analytics)\b/.test(n)) return true;
  return false;
}

function pickPrimaryGoogleAdsPurchaseKey(
  purchaseKeys: string[],
  ca: Record<string, { conversions: number; value: number }>,
  campaignName: string
): string | null {
  const ok = purchaseKeys.filter(k => {
    const row = ca[k];
    if (!row) return false;
    return !isPhantomStoreVisitPurchaseRow(k, row, campaignName);
  });
  if (ok.length === 0) return null;
  if (ok.length === 1) return ok[0];
  const lower = (s: string) => s.trim().toLowerCase();
  const hasData = (k: string) => (ca[k]?.conversions ?? 0) > 0 || (ca[k]?.value ?? 0) > 0;

  const gaImport = ok.find(k => isGoogleAnalyticsImportLabel(k) && hasData(k));
  if (gaImport) return gaImport;

  const exact = ok.find(k => lower(k) === 'purchase');
  if (exact && hasData(exact)) return exact;

  const paren = ok.find(k => /^purchase\s*\(/i.test(k.trim()) && hasData(k));
  if (paren) return paren;

  const web = ok.find(k => /website|web\s*store|ecommerce|shopify|woocommerce/i.test(k) && hasData(k));
  if (web) return web;

  const byConv = [...ok].sort((a, b) => (ca[b]?.conversions ?? 0) - (ca[a]?.conversions ?? 0));
  return byConv[0] ?? null;
}

/** Default "Active" filter: Enabled (Google Ads) / ACTIVE (Meta), excluding paused/completed/archived/removed/ended.
 * Unknown/empty status is shown (legacy imports). */
function isActiveLikeCampaignStatus(status: string | undefined): boolean {
  const s = (status || '').toLowerCase().trim();
  if (!s) return true;
  const excluded = new Set([
    'paused',
    'completed',
    'removed',
    'archived',
    'deleted',
    'ended',
    'campaign_paused',
  ]);
  return !excluded.has(s);
}

function formatConvCount(n: number): string {
  const dec = Math.abs(n % 1) > 1e-6 ? 2 : 0;
  return formatNumber(n, dec);
}

interface CampaignsPageProps {
  onSectionChange?: (section: string) => void;
}

export function CampaignsPage({ onSectionChange }: CampaignsPageProps = {}) {
  const { currentBrand } = useBrand();
  const { user } = useAuth();
  const { campaigns, isLoading, hasImported } = useCampaigns();
  const brandId = currentBrand?.id ?? null;
  const { data: connectorsDoc, isPending: connectorsStatusPending } = useQuery({
    queryKey: ['connectorsSummary', brandId, user?.uid ?? ''],
    queryFn: async () =>
      brandId
        ? FirestoreService.getDocumentWithTimeout<Record<string, { connected?: boolean }>>(
            'connectors',
            brandId,
            15000
          )
        : null,
    enabled: Boolean(brandId && user?.uid && !isLoading && !hasImported),
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const hasConnectedAdsOrMeta = Boolean(
    connectorsDoc?.google_ads?.connected || connectorsDoc?.meta?.connected
  );
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const LS_STATUS = 'campaigns_statusFilter';
  const [statusFilter, setStatusFilterState] = useState<string>(() => {
    try {
      return localStorage.getItem(LS_STATUS) ?? 'active';
    } catch {
      return 'active';
    }
  });
  const setStatusFilter = (v: string) => {
    setStatusFilterState(v);
    try {
      localStorage.setItem(LS_STATUS, v);
    } catch { /* ignore */ }
  };
  const { fromDate: globalFrom, toDate: globalTo } = useGlobalDate();
  // Local override: empty = use global. Resets to global on navigation (component unmount).
  const [localDateFrom, setLocalDateFrom] = useState('');
  const [localDateTo,   setLocalDateTo]   = useState('');
  const dateFrom = localDateFrom || globalFrom;
  const dateTo   = localDateTo   || globalTo;

  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const LS_CONV = 'campaigns_convFilter';
  const [convActionFilter, setConvActionFilter] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(LS_CONV) || '[]'); } catch { return []; }
  });
  const convFilterActive = convActionFilter.length > 0;
  const [showConvDropdown, setShowConvDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<'campaigns' | 'search_terms' | 'keywords' | 'geo'>('campaigns');
  const COLLAPSED_LIMIT = 12;
  const [tableExpanded, setTableExpanded] = useState(false);
  const { searchTerms, keywords, hasData: hasSearchData } = useSearchIntelligence();
  const [stSearch, setStSearch] = useState('');
  const [kwSearch, setKwSearch] = useState('');

  const handleDeleteCampaigns = async () => {
    if (!currentBrand?.id) return;
    if (!window.confirm(`Διαγραφή και των ${campaigns.length} καμπανιών του brand «${currentBrand.name}»; Η ενέργεια δεν αναιρείται.`)) return;
    setIsDeleting(true);
    try {
      await FirestoreService.deleteCollection('campaigns', currentBrand.id);
      queryClient.invalidateQueries({ queryKey: ['campaigns', currentBrand.id] });
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Οι καμπάνιες διαγράφηκαν.');
    } catch (e) {
      toast.error(`Η διαγραφή απέτυχε: ${e instanceof Error ? e.message : 'άγνωστο σφάλμα'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Resolve effective status for Meta campaigns that were imported with hardcoded 'active'
  const resolveStatus = useCallback((c: Campaign): string => {
    const raw = (c.status || '').toLowerCase();
    if (raw && raw !== 'active') return raw;
    // For Meta campaigns with dailyMetrics, check if the campaign is still recent
    const dm = (c as any).dailyMetrics as Record<string, any> | undefined;
    if (dm && Object.keys(dm).length > 0) {
      const latestDate = Object.keys(dm).sort().pop();
      if (latestDate) {
        const latest = new Date(latestDate);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 45);
        if (latest < cutoff) return 'completed';
      }
    }
    // Check end_date if it's not the sync range date (meta sets period ranges)
    if (c.end_date && !c.end_date.includes('2024') && !c.end_date.includes('2023')) {
      const end = new Date(c.end_date);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 14);
      if (end < cutoff && c.channel === 'Meta') return 'completed';
    }
    return raw || 'active';
  }, []);

  // Filter campaigns
  const filteredCampaigns = useMemo(() => {
    let filtered = (campaigns as Campaign[]).map(c => ({
      ...c,
      status: resolveStatus(c),
    }));

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(c => 
        c.name.toLowerCase().includes(query) ||
        c.channel?.toLowerCase().includes(query) ||
        c.period?.toLowerCase().includes(query)
      );
    }

    // Channel filter (include campaigns with matching source file when channel is Other)
    if (channelFilter !== 'all') {
      filtered = filtered.filter(c => {
        const ch = c.channel || 'Other';
        if (ch === channelFilter) return true;
        if (ch !== 'Other') return false;
        const src = ((c as { source?: string }).source || '').toLowerCase();
        if (channelFilter === 'Google Ads' && (src.includes('google') || src.includes('google ads'))) return true;
        if (channelFilter === 'Meta' && (src.includes('meta') || src.includes('facebook') || src.includes('instagram'))) return true;
        return false;
      });
    }

    // Status filter (default: active ≈ Google Enabled + Meta ACTIVE)
    if (statusFilter !== 'all') {
      filtered = filtered.filter(c => {
        const status = (c.status || '').toLowerCase();
        if (statusFilter === 'active') {
          return isActiveLikeCampaignStatus(c.status);
        }
        return status === statusFilter;
      });
    }

    // Date range filter (interval overlap vs [from, to) in local date semantics)
    if (dateFrom || dateTo) {
      filtered = filterCampaignsByScheduleDateOverlap(filtered, dateFrom || '', dateTo || '') as typeof filtered;
    }

    return filtered;
  }, [campaigns, searchQuery, channelFilter, statusFilter, dateFrom, dateTo, resolveStatus]);


  // Compute date-range-aware metrics per campaign (shared with ROI via `campaignDateRangeMetrics`)
  const campaignsWithDateMetrics = useMemo(() => {
    const useDateFilter = !!(dateFrom || dateTo);
    if (!useDateFilter) return filteredCampaigns;

    const fromDate = dateFrom || '0000-00-00';
    const toDate = dateTo || '9999-99-99';

    return applyCampaignDateRangeToMetrics(filteredCampaigns, fromDate, toDate) as typeof filteredCampaigns;
  }, [filteredCampaigns, dateFrom, dateTo]);

  const applyConvFilter = (c: Campaign): Campaign => {
    if (convActionFilter.length === 0) return c;
    const ca = c.conversionActions;
    if (!ca || Object.keys(ca).length === 0) {
      return {
        ...c,
        conversions: 0,
        conversion_value: 0,
        roas: 0,
      };
    }
    let filteredConversions = 0;
    let filteredValue = 0;
    const purchaseSelected = convActionFilter.includes('Purchase');
    const campaignName = c.name || '';

    const purchaseKeysExcludingOmni = (keys: string[]) =>
      keys.filter(k => k.toLowerCase() !== 'omni_purchase');

    for (const action of convActionFilter) {
      if (action === 'Purchase') {
        if (isMetaChannel(c.channel)) {
          const primary = getMetaPrimaryPurchaseFromActions(
            ca as Record<string, { conversions?: number; value?: number }>
          );
          if (primary) {
            filteredConversions += primary.conversions;
            filteredValue += primary.value;
          } else {
            for (const pk of purchaseKeysExcludingOmni(Object.keys(ca))) {
              const low = pk.toLowerCase();
              if (!low.includes('purchase')) continue;
              const row = ca[pk];
              if (!row) continue;
              if (isPhantomStoreVisitPurchaseRow(pk, row, campaignName)) continue;
              filteredConversions += row.conversions ?? 0;
              filteredValue += row.value ?? 0;
            }
          }
        } else if (isGoogleAdsLikeChannel(c.channel)) {
          let purchaseKeys = purchaseKeysExcludingOmni(Object.keys(ca)).filter(k =>
            k.toLowerCase().includes('purchase')
          );
          const primary = pickPrimaryGoogleAdsPurchaseKey(purchaseKeys, ca, campaignName);
          purchaseKeys = primary ? [primary] : [];
          for (const pk of purchaseKeys) {
            const row = ca[pk];
            if (!row) continue;
            if (isPhantomStoreVisitPurchaseRow(pk, row, campaignName)) continue;
            filteredConversions += row.conversions ?? 0;
            filteredValue += row.value ?? 0;
          }
        } else {
          for (const pk of purchaseKeysExcludingOmni(Object.keys(ca))) {
            const low = pk.toLowerCase();
            if (!low.includes('purchase')) continue;
            const row = ca[pk];
            if (!row) continue;
            if (isPhantomStoreVisitPurchaseRow(pk, row, campaignName)) continue;
            filteredConversions += row.conversions ?? 0;
            filteredValue += row.value ?? 0;
          }
        }
      } else {
        if (purchaseSelected && action.toLowerCase().includes('purchase')) continue;
        const a = ca[action];
        if (
          a &&
          !(
            action.toLowerCase().includes('purchase') &&
            isPhantomStoreVisitPurchaseRow(action, a, campaignName)
          )
        ) {
          filteredConversions += a.conversions;
          filteredValue += a.value ?? 0;
        }
      }
    }

    const conversion_value = Math.round(filteredValue * 100) / 100;
    const roas = (c.amount_spent || 0) > 0 ? Math.round((conversion_value / (c.amount_spent || 1)) * 100) / 100 : 0;
    return { ...c, conversions: filteredConversions, conversion_value, roas };
  };

  const campaignsWithConvFilter = useMemo(() => {
    if (convActionFilter.length === 0) return campaignsWithDateMetrics;
    return campaignsWithDateMetrics.map(applyConvFilter);
  }, [campaignsWithDateMetrics, convActionFilter]);

  const campaignsInConvView = useMemo(() => {
    if (!convFilterActive) return campaignsWithConvFilter;
    return campaignsWithConvFilter.filter((c) => {
      if (getDisplayConversions(c, true) > 0 || getDisplayConversionValue(c, true) > 0) return true;
      // Any channel: spend/impressions without a matching conversion-action row should still list the campaign.
      if ((c.amount_spent ?? 0) > 0 || (c.impressions ?? 0) > 0) return true;
      return false;
    });
  }, [campaignsWithConvFilter, convFilterActive]);

  /** KPI labels: Purchase/Sales when synced data has purchase_* (Google PURCHASE/STORE_SALES, Meta Pixel/Purchase). */
  const showPurchaseSalesHeadlines = useMemo(() => {
    if (convFilterActive) return false;
    return campaignsInConvView.some(
      x => typeof x.purchase_conversions === 'number' && !Number.isNaN(x.purchase_conversions as number)
    );
  }, [campaignsInConvView, convFilterActive]);

  const sortedCampaigns = useMemo(() => {
    if (!sortColumn) return campaignsInConvView;
    const sorted = [...campaignsInConvView].sort((a, b) => {
      let va: string | number = 0;
      let vb: string | number = 0;
      switch (sortColumn) {
        case 'name': va = a.name || ''; vb = b.name || ''; break;
        case 'channel': va = a.channel || ''; vb = b.channel || ''; break;
        case 'period': va = a.period || ''; vb = b.period || ''; break;
        case 'status': va = a.status || ''; vb = b.status || ''; break;
        case 'spent': va = a.amount_spent || 0; vb = b.amount_spent || 0; break;
        case 'impressions': va = a.impressions || 0; vb = b.impressions || 0; break;
        case 'clicks': va = a.clicks || 0; vb = b.clicks || 0; break;
        case 'ctr': va = a.ctr || 0; vb = b.ctr || 0; break;
        case 'conversions': va = getDisplayConversions(a, convFilterActive); vb = getDisplayConversions(b, convFilterActive); break;
        case 'conversion_value': va = getDisplayConversionValue(a, convFilterActive); vb = getDisplayConversionValue(b, convFilterActive); break;
        case 'roas': va = a.roas || 0; vb = b.roas || 0; break;
      }
      if (typeof va === 'string') return sortDirection === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDirection === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return sorted;
  }, [campaignsInConvView, sortColumn, sortDirection, convFilterActive]);


  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(col);
      const ascCols = ['name', 'channel'];
      setSortDirection(ascCols.includes(col) ? 'asc' : 'desc');
    }
  };

  const summaryStats = useMemo(() => {
    const list = campaignsInConvView;
    const total = list.length;

    let totalSpent = 0;
    let totalConversions = 0;
    let totalConversionValue = 0;
    /** Sum of max(0, budget − spend) only for campaigns with a declared budget > 0. */
    let availableBudget = 0;
    let hasBudgetData = false;

    for (const c of list) {
      totalSpent += c.amount_spent || 0;
      totalConversions += getDisplayConversions(c, convFilterActive);
      totalConversionValue += getDisplayConversionValue(c, convFilterActive);

      const cap = c.budget;
      if (typeof cap === 'number' && !Number.isNaN(cap) && cap > 0) {
        hasBudgetData = true;
        const spent = c.amount_spent || 0;
        availableBudget += Math.max(0, cap - spent);
      }
    }

    const avgROAS = totalSpent > 0 ? totalConversionValue / totalSpent : 0;

    const byChannel: Record<string, number> = {};
    list.forEach(c => {
      const channel = c.channel || 'Other';
      byChannel[channel] = (byChannel[channel] || 0) + 1;
    });

    return {
      total,
      totalSpent,
      totalConversions,
      totalConversionValue,
      avgROAS,
      byChannel,
      availableBudget,
      hasBudgetData,
    };
  }, [campaignsInConvView, convFilterActive]);

  const handleExportCampaigns = useCallback(() => {
    const list = campaignsInConvView;
    if (list.length === 0) return;
    const headers = [
      'Name',
      'Channel',
      'Status',
      'Impressions',
      'Clicks',
      'CTR %',
      'Spend',
      'Conversions',
      'Conv. Value',
      'ROAS',
      'CPA',
      'Start Date',
      'End Date',
    ];
    const rows = list.map(c => [
      c.name || '', c.channel || '', c.status || '',
      c.impressions ?? '', c.clicks ?? '',
      c.impressions ? ((c.clicks || 0) / c.impressions * 100).toFixed(2) : '',
      c.amount_spent ?? '', getDisplayConversions(c, convFilterActive), getDisplayConversionValue(c, convFilterActive),
      c.amount_spent ? (getDisplayConversionValue(c, convFilterActive) / c.amount_spent).toFixed(2) : '',
      getDisplayConversions(c, convFilterActive) ? ((c.amount_spent || 0) / getDisplayConversions(c, convFilterActive)).toFixed(2) : '',
      c.start_date || '', c.end_date || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(sanitizeSpreadsheetCell(v)).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `campaigns_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [campaignsInConvView, convFilterActive]);

  // Standard channels + unique from data (sorted: standard first, then data-derived)
  const STANDARD_CHANNELS = ['Meta', 'Google Ads', 'Google Shopping', 'Other'];
  const channels = useMemo(() => {
    const fromData = new Set<string>();
    (campaigns as Campaign[]).forEach(c => {
      const ch = c.channel || 'Other';
      fromData.add(ch);
    });
    const combined = new Set([...STANDARD_CHANNELS, ...fromData]);
    return Array.from(combined).sort((a, b) => {
      const aIdx = STANDARD_CHANNELS.indexOf(a);
      const bIdx = STANDARD_CHANNELS.indexOf(b);
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return a.localeCompare(b);
    });
  }, [campaigns]);

  const statuses = useMemo(() => {
    const unique = new Set<string>();
    (campaigns as Campaign[]).forEach(c => {
      unique.add(resolveStatus(c).toLowerCase());
    });
    return Array.from(unique).sort();
  }, [campaigns, resolveStatus]);

  const allConversionActions = useMemo(() => {
    const actions = new Set<string>();
    campaignsWithDateMetrics.forEach(c => {
      if (c.conversionActions) {
        Object.keys(c.conversionActions).forEach(a => {
          if (a.toLowerCase() === 'omni_purchase') return;
          actions.add(a);
        });
      }
    });
    // Synthetic "Purchase" only when no action name contains "purchase" — otherwise it
    // duplicates e.g. "Purchase Completed (Google Ads)" (same totals, confusing UX).
    const hasPurchaseVariant = Array.from(actions).some(a => a.toLowerCase().includes('purchase'));
    if (!hasPurchaseVariant && !actions.has('Purchase')) {
      actions.add('Purchase');
    }
    // Legacy / saved filter may still reference "Purchase" — keep it visible in the list.
    convActionFilter.forEach(a => {
      if (a) actions.add(a);
    });
    return Array.from(actions).sort();
  }, [campaignsWithDateMetrics, convActionFilter]);

  const toggleConvAction = (action: string) => {
    setConvActionFilter(prev => {
      const next = prev.includes(action) ? prev.filter(a => a !== action) : [...prev, action];
      localStorage.setItem(LS_CONV, JSON.stringify(next));
      return next;
    });
  };

  const clearConvFilter = () => {
    setConvActionFilter([]);
    localStorage.removeItem(LS_CONV);
  };


  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Spinner size="lg" label="Loading campaigns…" />
      </div>
    );
  }

  if (!hasImported) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Campaigns</h2>}
          description={
            <p className="text-sm text-[#4A4A4A] sm:text-base">Επισκόπηση και ανάλυση των καμπανιών σας</p>
          }
        />
        <Card padding="lg" className="text-center py-12 space-y-3">
          <p className="text-[#4A4A4A]">
            Δεν υπάρχουν ακόμα imported campaigns.
          </p>
          {connectorsStatusPending ? (
            <p className="text-sm text-[#6B7280]">Έλεγχος κατάστασης συνδέσεων…</p>
          ) : hasConnectedAdsOrMeta ? (
            <p className="text-sm text-[#4A4A4A] max-w-xl mx-auto">
              Τα Google Ads / Meta είναι συνδεδεμένα αλλά δεν εμφανίζονται ακόμα campaigns. Ανοίξτε τις{' '}
              <button
                type="button"
                onClick={() => onSectionChange?.('data-campaigns')}
                className="font-semibold text-[var(--nts-accent)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-1 rounded"
              >
                ρυθμίσεις καμπανιών
              </button>
              {' '}
              και εκτελέστε <strong className="font-semibold text-[#1A1A1A]">Sync</strong> για import ή refresh των
              campaigns από τον τελευταίο συγχρονισμό.
            </p>
          ) : (
            <p className="text-sm text-[#4A4A4A]">
              Συνδέστε Google Ads ή Meta από τις{' '}
              <button
                type="button"
                onClick={() => onSectionChange?.('data-campaigns')}
                className="font-semibold text-[var(--nts-accent)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-1 rounded"
              >
                ρυθμίσεις καμπανιών
              </button>
              .
            </p>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PageHeader
        className="!gap-2 lg:!gap-4 lg:!items-center"
        toolbarAriaLabel="Export and delete campaigns"
        title={<h2 className="text-lg font-bold text-[#1A1A1A] sm:text-xl">Campaigns</h2>}
        description={
          <p className="text-xs text-[#6B7280] sm:text-sm">
            Imported campaigns: {summaryStats.total}
          </p>
        }
        meta={
          import.meta.env.MODE === 'development'
            ? (() => {
                const bySource: Record<string, number> = {};
                (campaigns as Campaign[]).forEach(c => {
                  const source = (c as any).source || 'Unknown';
                  bySource[source] = (bySource[source] || 0) + 1;
                });
                return (
                  <p className="text-xs text-[#9CA3AF]">
                    Πηγές: {Object.entries(bySource).map(([src, count]) => `${src}: ${count}`).join(', ')}
                  </p>
                );
              })()
            : null
        }
        actions={
          <>
            <MetaAttributionSelector />
            <Button
              variant="secondary"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={handleDeleteCampaigns}
              disabled={isDeleting || !hasImported}
              className="min-h-[36px] flex-1 basis-[calc(50%-0.1875rem)] text-[#DC2626] hover:bg-[#FEE2E2] sm:flex-initial sm:basis-auto"
            >
              {isDeleting ? 'Διαγραφή…' : 'Διαγραφή όλων'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Download size={14} />}
              onClick={handleExportCampaigns}
              disabled={campaignsInConvView.length === 0}
              className="min-h-[36px] flex-1 basis-[calc(50%-0.1875rem)] sm:flex-initial sm:basis-auto"
            >
              Εξαγωγή .csv
            </Button>
          </>
        }
      />

      {/* Automation Alerts — compact to leave room for tables */}
      <AlertsBanner filterGroup="campaigns" maxAlerts={3} compact onNavigate={onSectionChange} />

      {/* Summary KPIs — right below alerts (only on the Campaigns tab) */}
      {activeTab === 'campaigns' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          <Card padding="sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-[#4A4A4A] flex items-center gap-1">
                  Διαθέσιμο budget{' '}
                  <Tooltip
                    content="Άθροισμα (δηλωμένο budget − δαπάνη) ανά καμπάνια όπου υπάρχει budget στο import. Η δαπάνη ακολουθεί το επιλεγμένο εύρος ημερομηνιών· αν δεν εμφανίζεται τιμή, τα campaigns δεν έχουν πεδίο budget."
                    size={13}
                  />
                </p>
                <p className="text-xl font-bold text-[#1A1A1A] font-mono mt-0.5 tabular-nums">
                  {summaryStats.hasBudgetData ? `${EUR}${formatCurrency(summaryStats.availableBudget, 2)}` : '—'}
                </p>
              </div>
              <div className="w-10 h-10 shrink-0 bg-[#E0F2FE] rounded-lg flex items-center justify-center">
                <Wallet size={20} className="text-[#0369A1]" />
              </div>
            </div>
          </Card>

          <Card padding="sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-[#4A4A4A] flex items-center gap-1">Total spend <Tooltip content="Συνολική διαφημιστική δαπάνη για τα τρέχοντα φίλτρα (ημερομηνίες, κανάλι, αναζήτηση κ.λπ.)." size={13} /></p>
                <p className="text-xl font-bold text-[#1A1A1A] font-mono mt-0.5 tabular-nums">
                  {EUR}{formatCurrency(summaryStats.totalSpent, 2)}
                </p>
              </div>
              <div className="w-10 h-10 shrink-0 bg-[var(--nts-light-gray)] rounded-lg flex items-center justify-center">
                <DollarSign size={20} className="text-[var(--nts-accent)]" />
              </div>
            </div>
          </Card>

          <Card padding="sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-[#4A4A4A] flex items-center gap-1">
                  {showPurchaseSalesHeadlines ? 'Sales' : 'Conversions'}{' '}
                  <Tooltip
                    content={
                      convFilterActive
                        ? 'Μόνο οι επιλεγμένες conversion actions.'
                        : showPurchaseSalesHeadlines
                          ? 'Google Ads: conversion_action_category PURCHASE + STORE_SALES (όπως Purchases στο UI). Meta: πρώτα standard Purchase (συγκλίνει με Ads Manager όταν υπάρχουν Pixel+CAPI), έπειτα Purchase (Pixel). Με φίλτρο ενέργειας το νόημα αλλάζει.'
                          : 'Conversion counts από το sync.'
                    }
                    size={13}
                  />
                </p>
                <p className="text-xl font-bold text-[#1A1A1A] font-mono mt-0.5 tabular-nums">
                  {formatConvCount(summaryStats.totalConversions)}
                </p>
              </div>
              <div className="w-10 h-10 shrink-0 bg-[#DCFCE7] rounded-lg flex items-center justify-center">
                <TrendingUp size={20} className="text-[#22C55E]" />
              </div>
            </div>
          </Card>

          <Card padding="sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-[#4A4A4A] flex items-center gap-1">
                  {showPurchaseSalesHeadlines ? 'Sales value' : 'Conversion value'}{' '}
                  <Tooltip
                    content={
                      convFilterActive
                        ? 'Αξία μόνο για τις επιλεγμένες ενέργειες.'
                        : showPurchaseSalesHeadlines
                          ? 'Αξία από τις ίδιες ενέργειες πώλησης με την κάρτα Sales.'
                          : 'Συνολική conversion value.'
                    }
                    size={13}
                  />
                </p>
                <p className="text-xl font-bold text-[#1A1A1A] font-mono mt-0.5 tabular-nums">
                  {EUR}{formatCurrency(summaryStats.totalConversionValue, 2)}
                </p>
              </div>
              <div className="w-10 h-10 shrink-0 bg-[#F5F5F5] rounded-lg flex items-center justify-center">
                <TrendingUp size={20} className="text-[#4A4A4A]" />
              </div>
            </div>
          </Card>

          <Card padding="sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-[#4A4A4A] flex items-center gap-1">
                  Platform ROAS{' '}
                  <Tooltip
                    content={
                      showPurchaseSalesHeadlines && !convFilterActive
                        ? 'Τζίρος πωλήσεων / ad spend για τα τρέχοντα φίλτρα. Δεν περιλαμβάνει λοιπά marketing costs.'
                        : 'Conversion value / ad spend για τα εμφανιζόμενα campaigns. Δεν περιλαμβάνει λοιπά marketing costs.'
                    }
                    size={13}
                  />
                </p>
                <p className="text-xl font-bold text-[#1A1A1A] font-mono mt-0.5 tabular-nums">
                  {formatMultiplier(summaryStats.avgROAS, 2)}
                </p>
              </div>
              <div className="w-10 h-10 shrink-0 bg-[#FEF3C7] rounded-lg flex items-center justify-center">
                <TrendingUp size={20} className="text-[#F59E0B]" />
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Tabs + date range (same row on md+) */}
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-x-4 md:gap-y-2">
        <div className="-mx-1 max-w-full overflow-x-auto pb-1 sm:mx-0 sm:overflow-visible sm:pb-0">
        <div className="flex w-max gap-0.5 rounded-lg bg-[#F5F5F5] p-0.5 sm:w-fit">
          {(['campaigns', 'search_terms', 'keywords', 'geo'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${
                activeTab === tab
                  ? 'bg-white text-[#111827] shadow-sm'
                  : 'text-[#6B7280] hover:text-[#111827]'
              }`}
            >
              {tab === 'campaigns' ? `Campaigns (${summaryStats.total})` :
               tab === 'search_terms' ? `Search Terms ${hasSearchData ? `(${searchTerms.length})` : ''}` :
               tab === 'keywords' ? `Keywords ${hasSearchData ? `(${keywords.length})` : ''}` :
               'Τοποθεσία'}
            </button>
          ))}
        </div>
        </div>
        {activeTab === 'campaigns' && (
          <div className="flex flex-wrap items-center gap-2 md:justify-end min-w-0 md:flex-1">
            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onChange={(f, t) => { setLocalDateFrom(f); setLocalDateTo(t); }}
              onClear={() => { setLocalDateFrom(''); setLocalDateTo(''); }}
            />
            {(localDateFrom || localDateTo) && (
              <button
                onClick={() => { setLocalDateFrom(''); setLocalDateTo(''); }}
                className="text-[10px] text-[var(--nts-orange)] hover:underline whitespace-nowrap"
              >
                ↩ Επαναφορά global
              </button>
            )}
            <span className="text-[10px] text-[#9CA3AF] leading-snug max-w-[220px] md:max-w-none md:truncate">
              Σύνολα = επιλεγμένο εύρος ημερομηνιών.
            </span>
          </div>
        )}
      </div>

      {activeTab === 'campaigns' && <ChannelPerformanceHistoryCard dateFrom={dateFrom} dateTo={dateTo} />}

      {activeTab === 'campaigns' && (
        <CampaignsChannelInsights campaigns={campaignsInConvView} />
      )}

      {(activeTab === 'search_terms' || activeTab === 'keywords') && (
        <SearchIntelligenceTab
          type={activeTab}
          searchTerms={searchTerms}
          keywords={keywords}
          hasData={hasSearchData}
          search={activeTab === 'search_terms' ? stSearch : kwSearch}
          onSearchChange={activeTab === 'search_terms' ? setStSearch : setKwSearch}
        />
      )}

      {activeTab === 'geo' && (
        <CampaignsGeoTab campaigns={filteredCampaigns} />
      )}

      {activeTab === 'campaigns' && <>
      {/* Filters */}
      <Card padding="sm">
        <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap">
          <div className="min-w-0 lg:min-w-[180px] lg:flex-1">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4A4A4A]" />
              <input
                type="text"
                placeholder="Search campaigns…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)] focus:bg-white transition-all"
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center lg:col-span-1">
            <Filter size={18} className="text-[#4A4A4A]" />
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="w-full rounded-lg border border-transparent bg-[#F5F5F5] px-3 py-2 text-sm transition-all focus:border-[var(--nts-accent)] focus:bg-white focus:outline-none sm:w-auto"
            >
              <option value="all">Όλα τα κανάλια</option>
              {channels.map(ch => (
                <option key={ch} value={ch}>{ch}</option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              title="Ενεργές μόνο: Google Ads = Enabled, Meta = ACTIVE — όχι paused, ολοκληρωμένες ή removed."
              className="w-full max-w-full rounded-lg border border-transparent bg-[#F5F5F5] px-3 py-2 text-sm transition-all focus:border-[var(--nts-accent)] focus:bg-white focus:outline-none sm:w-auto sm:max-w-[220px]"
            >
              <option value="all">All statuses</option>
              <option value="active">Ενεργές μόνο</option>
              {statuses.filter(s => s !== 'active' && s !== 'enabled' && s !== 'eligible').map(status => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>

            {/* Conversion Action Filter */}
            {allConversionActions.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowConvDropdown(!showConvDropdown)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-all ${
                    convActionFilter.length > 0
                      ? 'bg-[var(--nts-accent)] text-white'
                      : 'bg-[#F5F5F5] text-[#4A4A4A] hover:bg-[#E5E5E5]'
                  }`}
                >
                  <Filter size={14} />
                  {convActionFilter.length > 0
                    ? `Conversions (${convActionFilter.length})`
                    : 'Conversion type'}
                </button>
                {showConvDropdown && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowConvDropdown(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-[#E5E5E5] rounded-xl shadow-lg py-2 min-w-[220px] max-h-[320px] overflow-y-auto">
                      <div className="px-3 py-1.5 border-b border-[#F0F0F0] flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Conversion actions</span>
                        {convActionFilter.length > 0 && (
                          <button onClick={clearConvFilter} className="text-[10px] text-[var(--nts-accent)] hover:underline">Καθαρισμός</button>
                        )}
                      </div>
                      {allConversionActions.map(action => (
                        <label
                          key={action}
                          className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#F5F5F5] cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={convActionFilter.includes(action)}
                            onChange={() => toggleConvAction(action)}
                            className="w-3.5 h-3.5 rounded border-[#D1D5DB] text-[var(--nts-accent)] focus:ring-[var(--nts-accent)]"
                          />
                          <span className="text-xs text-[#1A1A1A]">{action}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Campaigns Table */}
      <Card padding="md">
        <div className="flex items-center justify-between gap-2">
          <CardHeader
            className="!mb-0"
            title="Campaign list"
            subtitle={
              sortedCampaigns.length === 1
                ? '1 campaign'
                : `${sortedCampaigns.length} campaigns`
            }
          />
          {sortedCampaigns.length > COLLAPSED_LIMIT && (
            <button
              onClick={() => setTableExpanded(!tableExpanded)}
              className="text-xs font-medium text-[var(--nts-accent)] hover:underline px-3 py-1.5 rounded-md hover:bg-[var(--nts-accent)]/5 transition-colors"
            >
              {tableExpanded ? 'Σύμπτυξη' : `Εμφάνιση όλων (${sortedCampaigns.length})`}
            </button>
          )}
        </div>

        {filteredCampaigns.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[#4A4A4A]">Δεν υπάρχουν campaigns που να ταιριάζουν με τα φίλτρα.</p>
          </div>
        ) : convFilterActive && sortedCampaigns.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[#4A4A4A]">Κανένα campaign δεν έχει τις επιλεγμένες conversions. Δοκιμάστε άλλα φίλτρα (π.χ. αφαιρέστε την ενέργεια Purchase αν δεν υπάρχουν πραγματικές αγορές).</p>
          </div>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full">
              <thead>
                <tr className="text-left text-[11px] text-[#4A4A4A] border-b border-[#E5E5E5]">
                  <SortableHeader col="name" label="Campaign" current={sortColumn} dir={sortDirection} onSort={handleSort} className="" />
                  <SortableHeader col="channel" label="Channel" current={sortColumn} dir={sortDirection} onSort={handleSort} className="whitespace-nowrap" />
                  <SortableHeader col="status" label="Status" current={sortColumn} dir={sortDirection} onSort={handleSort} className="whitespace-nowrap hidden md:table-cell" />
                  <SortableHeader col="impressions" label="Impr." current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap hidden lg:table-cell" />
                  <SortableHeader col="clicks" label="Clicks" current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap hidden md:table-cell" />
                  <SortableHeader col="ctr" label="CTR" current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap hidden lg:table-cell" />
                  <SortableHeader
                    col="conversions"
                    label={showPurchaseSalesHeadlines && !convFilterActive ? 'Πωλ.' : 'Conv.'}
                    title={showPurchaseSalesHeadlines && !convFilterActive ? 'Πωλήσεις (Purchase/Sales)' : 'Conversions'}
                    current={sortColumn}
                    dir={sortDirection}
                    onSort={handleSort}
                    align="right"
                    className="whitespace-nowrap hidden sm:table-cell"
                  />
                  <SortableHeader col="spent" label="Spent" current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap hidden sm:table-cell" />
                  <SortableHeader
                    col="conversion_value"
                    label={showPurchaseSalesHeadlines && !convFilterActive ? 'Τζίρ.' : 'Value'}
                    title={showPurchaseSalesHeadlines && !convFilterActive ? 'Τζίρος πωλήσεων' : 'Conversion value'}
                    current={sortColumn}
                    dir={sortDirection}
                    onSort={handleSort}
                    align="right"
                    className="whitespace-nowrap hidden sm:table-cell"
                  />
                  <SortableHeader col="roas" label="ROAS" current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap" />
                </tr>
              </thead>
              <tbody>
                {(tableExpanded ? sortedCampaigns : sortedCampaigns.slice(0, COLLAPSED_LIMIT)).map((campaign, index) => (
                  <motion.tr
                    key={campaign.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className="border-b border-[#E5E5E5] hover:bg-[#F5F5F5] transition-colors"
                  >
                    <td className="py-2 px-3 max-w-[200px] lg:max-w-[280px]">
                      <div className="font-medium text-xs text-[#1A1A1A] truncate">{campaign.name}</div>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <ChannelBadge channel={campaign.channel || 'Other'} />
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap hidden md:table-cell">
                      <Badge 
                        variant={
                          campaign.status === 'active' || campaign.status === 'enabled' || campaign.status === 'eligible' || !campaign.status
                            ? 'success' 
                            : 'default'
                        } 
                        size="sm"
                      >
                        {campaign.status || 'Active'}
                      </Badge>
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap hidden lg:table-cell">
                      {campaign.impressions ? formatNumber(campaign.impressions) : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap hidden md:table-cell">
                      {campaign.clicks ? formatNumber(campaign.clicks) : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap hidden lg:table-cell">
                      {campaign.ctr ? formatPercent(campaign.ctr, 2) : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap hidden sm:table-cell">
                      {formatConvCount(getDisplayConversions(campaign, convFilterActive))}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap hidden sm:table-cell">
                      {campaign.amount_spent ? `${EUR}${formatCurrency(campaign.amount_spent, 2)}` : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap hidden sm:table-cell" title="Conversion value">
                      {EUR}{formatCurrency(getDisplayConversionValue(campaign, convFilterActive), 2)}
                    </td>
                    <td className="py-3 px-2 text-right">
                      {Number.isFinite(campaign.roas ?? NaN) ? (
                        <Badge variant={(campaign.roas ?? 0) > 0 ? 'success' : 'default'} size="sm">
                          {formatMultiplier(campaign.roas ?? 0, 2)}
                        </Badge>
                      ) : (
                        '-'
                      )}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <BudgetOpportunitySection campaigns={(campaigns ?? []) as Campaign[]} />

      </>}
    </div>
  );
}

// Search Intelligence tab (Google Ads search terms / keywords)

function SearchIntelligenceTab({ type, searchTerms, keywords, hasData, search, onSearchChange }: {
  type: 'search_terms' | 'keywords';
  searchTerms: any[];
  keywords: any[];
  hasData: boolean;
  search: string;
  onSearchChange: (v: string) => void;
}) {
  const items = type === 'search_terms' ? searchTerms : keywords;
  const q = search.toLowerCase();
  const filtered = q
    ? items.filter((item: any) => {
        const text = type === 'search_terms' ? item.term : item.keyword;
        return (text || '').toLowerCase().includes(q) || (item.campaign || '').toLowerCase().includes(q);
      })
    : items;

  const searchIntelSubtitle =
    type === 'search_terms'
      ? filtered.length === 0
        ? 'No search terms in current filter · last 90 days'
        : filtered.length === 1
          ? '1 search term · last 90 days'
          : `${filtered.length} search terms · last 90 days`
      : filtered.length === 0
        ? 'No keywords in current filter · last 90 days'
        : filtered.length === 1
          ? '1 keyword · last 90 days'
          : `${filtered.length} keywords · last 90 days`;

  if (!hasData) {
    return (
      <Card padding="lg" className="text-center py-12">
        <p className="text-[#6B7280]">
          {type === 'search_terms'
            ? 'Δεν υπάρχουν ακόμη search terms μετά τον τελευταίο Google Ads sync.'
            : 'Δεν υπάρχουν ακόμη keywords μετά τον τελευταίο Google Ads sync.'}
        </p>
        <p className="text-xs text-[#9CA3AF] mt-2">
          Εκτελέστε ξανά Sync για Google Ads από τις ρυθμίσεις συνδέσεων καμπανιών.
        </p>
      </Card>
    );
  }

  return (
    <Card padding="lg">
      <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardHeader
          className="!mb-0 min-w-0"
          title={type === 'search_terms' ? 'Search Terms' : 'Keywords'}
          subtitle={searchIntelSubtitle}
        />
        <div className="relative w-full sm:w-64 sm:shrink-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={type === 'search_terms' ? 'Search term…' : 'Search keyword…'}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#F5F5F5] border-none text-sm focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)]/20"
          />
        </div>
      </div>

      <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-[#F9FAFB] z-10">
            <tr className="text-[11px] text-[#6B7280] uppercase tracking-wider border-b border-[#E5E7EB]">
              <th className="pb-2 px-2 font-medium">{type === 'search_terms' ? 'Search Term' : 'Keyword'}</th>
              {type === 'keywords' && <th className="pb-2 px-2 font-medium">Match</th>}
              {type === 'keywords' && <th className="pb-2 px-2 font-medium text-right">QS</th>}
              <th className="pb-2 px-2 font-medium">Campaign</th>
              <th className="pb-2 px-2 font-medium text-right">Impr.</th>
              <th className="pb-2 px-2 font-medium text-right">Clicks</th>
              <th className="pb-2 px-2 font-medium text-right">CTR</th>
              <th className="pb-2 px-2 font-medium text-right">Conv.</th>
              <th className="pb-2 px-2 font-medium text-right">Cost</th>
              <th className="pb-2 px-2 font-medium text-right">Conv. Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F3F4F6]">
            {filtered.slice(0, 200).map((item: any, i: number) => {
              const text = type === 'search_terms' ? item.term : item.keyword;
              const ctr = item.impressions > 0 ? ((item.clicks / item.impressions) * 100).toFixed(2) : '0';
              const qsBg = item.qualityScore >= 7 ? '#DCFCE7' : item.qualityScore >= 4 ? '#FEF9C3' : item.qualityScore ? '#FEE2E2' : '#F9FAFB';
              const qsColor = item.qualityScore >= 7 ? '#166534' : item.qualityScore >= 4 ? '#854D0E' : item.qualityScore ? '#991B1B' : '#9CA3AF';

              return (
                <tr key={`${text}-${i}`} className="hover:bg-[#FAFAFA] transition-colors text-sm">
                  <td className="py-2 px-2 font-medium text-[#111827] max-w-xs truncate">{text}</td>
                  {type === 'keywords' && (
                    <td className="py-2 px-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F3F4F6] text-[#374151] uppercase">
                        {(item.matchType || '').replace('_', ' ').toLowerCase()}
                      </span>
                    </td>
                  )}
                  {type === 'keywords' && (
                    <td className="py-2 px-2 text-right">
                      {item.qualityScore ? (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold" style={{ backgroundColor: qsBg, color: qsColor }}>
                          {item.qualityScore}
                        </span>
                      ) : <span className="text-[#9CA3AF]">?</span>}
                    </td>
                  )}
                  <td className="py-2 px-2 text-[#6B7280] text-xs max-w-[180px] truncate">{item.campaign}</td>
                  <td className="py-2 px-2 text-right font-mono text-[#374151]">{item.impressions.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right font-mono text-[#374151]">{item.clicks.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right font-mono text-[#374151]">{ctr}%</td>
                  <td className="py-2 px-2 text-right font-mono text-[#374151]">{item.conversions > 0 ? item.conversions.toFixed(1) : '?'}</td>
                  <td className="py-2 px-2 text-right font-mono text-[#374151]">{EUR}{formatCurrency(item.cost, 2)}</td>
                  <td className="py-2 px-2 text-right font-mono text-[#374151]">
                    {item.conversionValue > 0 ? `${EUR}${formatCurrency(item.conversionValue, 2)}` : '?'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-sm text-[#9CA3AF] text-center py-8">
            {search ? 'No results match your search.' : 'No data available.'}
          </p>
        )}
        {filtered.length > 200 && (
          <p className="text-xs text-[#9CA3AF] text-center py-3">
            Showing first 200 of {filtered.length} total
          </p>
        )}
      </div>
    </Card>
  );
}

function SortableHeader({ col, label, title: thTitle, current, dir, onSort, align, className = '' }: {
  col: string; label: string; title?: string; current: string | null; dir: 'asc' | 'desc'; onSort: (col: string) => void; align?: 'right'; className?: string;
}) {
  const active = current === col;
  return (
    <th
      title={thTitle}
      className={`pb-2 font-medium px-2 cursor-pointer select-none hover:text-[var(--nts-charcoal)] transition-colors ${align === 'right' ? 'text-right' : ''} ${className}`}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {align === 'right' && (
          active
            ? (dir === 'asc' ? <ArrowUp size={12} className="text-[var(--nts-accent)]" /> : <ArrowDown size={12} className="text-[var(--nts-accent)]" />)
            : <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-40" />
        )}
        <span className={active ? 'text-[var(--nts-charcoal)] font-semibold' : ''}>{label}</span>
        {align !== 'right' && (
          active
            ? (dir === 'asc' ? <ArrowUp size={12} className="text-[var(--nts-accent)]" /> : <ArrowDown size={12} className="text-[var(--nts-accent)]" />)
            : <ArrowUpDown size={12} className="opacity-30" />
        )}
      </span>
    </th>
  );
}

const CHANNEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Google Ads':      { bg: '#E8F5E9', text: '#2E7D32', border: '#A5D6A7' },
  'Google Shopping': { bg: '#E8F5E9', text: '#2E7D32', border: '#A5D6A7' },
  'Meta':            { bg: '#E3F2FD', text: '#1565C0', border: '#90CAF9' },
  'Facebook':        { bg: '#E3F2FD', text: '#1565C0', border: '#90CAF9' },
  'Instagram':       { bg: '#FCE4EC', text: '#C62828', border: '#F48FB1' },
  'TikTok':          { bg: '#F3E5F5', text: '#6A1B9A', border: '#CE93D8' },
  'Email':           { bg: '#FFF8E1', text: '#F57F17', border: '#FFE082' },
  'SMS':             { bg: '#EDE7F6', text: '#4527A0', border: '#B39DDB' },
  'LinkedIn':        { bg: '#E3F2FD', text: '#0D47A1', border: '#90CAF9' },
  'X (Twitter)':     { bg: '#ECEFF1', text: '#37474F', border: '#B0BEC5' },
  'Pinterest':       { bg: '#FCE4EC', text: '#AD1457', border: '#F48FB1' },
};
const DEFAULT_CHANNEL_COLOR = { bg: '#F5F5F5', text: '#616161', border: '#E0E0E0' };

function ChannelBadge({ channel }: { channel: string }) {
  const c = CHANNEL_COLORS[channel] || DEFAULT_CHANNEL_COLOR;
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium border whitespace-nowrap"
      style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}
    >
      {channel}
    </span>
  );
}
