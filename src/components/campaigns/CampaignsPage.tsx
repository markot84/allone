import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { TrendingUp, Filter, Download, Search, DollarSign, Trash2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { Card, CardHeader, Badge, Button, Spinner, useToast, Tooltip, AlertsBanner } from '../common';
import { DateRangePicker } from '../ui/DateRangePicker';
import { useCampaigns, useBrand } from '../../hooks';
import { useSearchIntelligence } from '../../hooks/useSearchIntelligence';
import { FirestoreService } from '../../services/firestore';
import { formatCurrency, formatNumber, formatMultiplier, formatPercent } from '../../utils/format';
import type { Campaign } from '../../types';

function parseCampaignDate(d: string | number | undefined): Date | null {
  if (d === null || d === undefined || d === '') return null;
  const str = String(d).trim();
  if (!str) return null;

  // Excel serial date number (e.g. 45658 = 2025-01-01)
  if (/^\d+$/.test(str)) {
    const serial = parseInt(str, 10);
    if (serial > 30000 && serial < 60000) {
      const date = new Date((serial - 25569) * 86400 * 1000);
      return isNaN(date.getTime()) ? null : date;
    }
    return null;
  }

  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// Returns the fraction [0,1] of a dailyMetrics bucket that overlaps [fromDate, toDate].
// Daily keys (YYYY-MM-DD): 0 or 1 exactly.
// Monthly keys (day === '01'): proportional (e.g. "March 28 only" → 1/31 of March's aggregate).
// This prevents showing full-month Meta data when the user selects a single day or partial month.
function bucketOverlapFraction(date: string, fromDate: string, toDate: string): number {
  if (date.slice(8, 10) === '01') {
    const [year, month] = date.slice(0, 7).split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthEnd = `${date.slice(0, 7)}-${String(daysInMonth).padStart(2, '0')}`;
    if (date > toDate || monthEnd < fromDate) return 0;
    const overlapStart = date > fromDate ? date : fromDate;
    const overlapEnd = monthEnd < toDate ? monthEnd : toDate;
    const overlapDays = Math.round((new Date(overlapEnd).getTime() - new Date(overlapStart).getTime()) / 86400000) + 1;
    return overlapDays / daysInMonth;
  }
  return date >= fromDate && date <= toDate ? 1 : 0;
}

function sumConversionActions(ca: Campaign['conversionActions'] | undefined): { conv: number; value: number } {
  if (!ca) return { conv: 0, value: 0 };
  return Object.values(ca).reduce(
    (acc, a) => ({
      conv: acc.conv + (a?.conversions ?? 0),
      value: acc.value + (a?.value ?? 0),
    }),
    { conv: 0, value: 0 }
  );
}

/**
 * Conversions με fallback σε conversionActions.
 * Αν το aggregate field (c.conversions) είναι 0 αλλά υπάρχουν conversionActions,
 * χρησιμοποιεί το άθροισμα των actions (π.χ. παλιό sync που έγραψε 0 στο root αλλά έχει actions).
 */
function getDisplayConversions(c: Campaign): number {
  const raw = c.conversions;
  const n = raw != null ? (typeof raw === 'number' ? raw : parseFloat(String(raw))) : NaN;
  const fromActions = sumConversionActions(c.conversionActions).conv;
  if (!Number.isNaN(n) && n > 0) return n;
  if (fromActions > 0) return fromActions;
  return Number.isNaN(n) ? 0 : n; // preserve explicit 0 only when no actions either
}

function getDisplayConversionValue(c: Campaign): number {
  const any = c as Campaign & { conversionValue?: number };
  const raw = c.conversion_value ?? any.conversionValue;
  const n = raw != null ? (typeof raw === 'number' ? raw : parseFloat(String(raw))) : NaN;
  const fromActions = sumConversionActions(c.conversionActions).value;
  if (!Number.isNaN(n) && n > 0) return n;
  if (fromActions > 0) return fromActions;
  return Number.isNaN(n) ? 0 : n;
}

function formatConvCount(n: number): string {
  return formatNumber(Math.round(n), 0);
}

interface CampaignsPageProps {
  onSectionChange?: (section: string) => void;
}

export function CampaignsPage({ onSectionChange }: CampaignsPageProps = {}) {
  const { currentBrand } = useBrand();
  const { campaigns, isLoading, hasImported } = useCampaigns();
  const brandId = currentBrand?.id ?? null;
  const { data: connectorsDoc, isPending: connectorsStatusPending } = useQuery({
    queryKey: ['connectorsSummary', brandId],
    queryFn: async () =>
      brandId
        ? FirestoreService.getDocumentWithTimeout<Record<string, { connected?: boolean }>>(
            'connectors',
            brandId,
            15000
          )
        : null,
    enabled: Boolean(brandId && !isLoading && !hasImported),
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
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const LS_FROM = 'campaigns_dateFrom';
  const LS_TO   = 'campaigns_dateTo';
  const [dateFrom, setDateFromState] = useState<string>(() => localStorage.getItem(LS_FROM) ?? '');
  const [dateTo,   setDateToState]   = useState<string>(() => localStorage.getItem(LS_TO)   ?? '');

  const setDateFrom = (v: string) => { setDateFromState(v); localStorage.setItem(LS_FROM, v); };
  const setDateTo   = (v: string) => { setDateToState(v);   localStorage.setItem(LS_TO,   v); };

  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const LS_CONV = 'campaigns_convFilter';
  const [convActionFilter, setConvActionFilter] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(LS_CONV) || '[]'); } catch { return []; }
  });
  const [showConvDropdown, setShowConvDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<'campaigns' | 'search_terms' | 'keywords'>('campaigns');
  const COLLAPSED_LIMIT = 12;
  const [tableExpanded, setTableExpanded] = useState(false);
  const { searchTerms, keywords, hasData: hasSearchData } = useSearchIntelligence();
  const [stSearch, setStSearch] = useState('');
  const [kwSearch, setKwSearch] = useState('');

  const handleDeleteCampaigns = async () => {
    if (!currentBrand?.id) return;
    if (!window.confirm(`Διαγραφή όλων των campaigns (${campaigns.length}) για το brand "${currentBrand.name}"; Αυτή η ενέργεια δεν αναιρείται.`)) return;
    setIsDeleting(true);
    try {
      await FirestoreService.deleteCollection('campaigns', currentBrand.id);
      queryClient.invalidateQueries({ queryKey: ['campaigns', currentBrand.id] });
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Τα campaigns διαγράφηκαν επιτυχώς.');
    } catch (e) {
      toast.error(`Σφάλμα διαγραφής: ${e instanceof Error ? e.message : 'Unknown error'}`);
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

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(c => {
        const status = (c.status || '').toLowerCase();
        if (statusFilter === 'active') {
          return status === 'active' || status === 'enabled' || status === 'eligible' || !status;
        }
        return status === statusFilter;
      });
    }

    // Date range filter
    if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(dateFrom).getTime() : 0;
      const to = dateTo ? new Date(dateTo).getTime() + 86400000 : Infinity;
      filtered = filtered.filter(c => {
        let start = parseCampaignDate(c.start_date);
        let end = parseCampaignDate(c.end_date);
        if (!start && !end && c.period) {
          const m = c.period.match(/(\d{4}-\d{2}-\d{2})\s*[-–]\s*(\d{4}-\d{2}-\d{2})/);
          if (m) {
            start = parseCampaignDate(m[1]);
            end = parseCampaignDate(m[2]);
          }
        }
        const campStart = start ? start.getTime() : null;
        const campEnd = end ? end.getTime() : null;
        if (!campStart && !campEnd) return true;
        const overlapStart = campStart ? campStart <= to : campEnd ? campEnd >= from : true;
        const overlapEnd = campEnd ? campEnd >= from : campStart ? campStart <= to : true;
        return overlapStart && overlapEnd;
      });
    }

    return filtered;
  }, [campaigns, searchQuery, channelFilter, statusFilter, dateFrom, dateTo]);

  const handleExportCampaigns = useCallback(() => {
    if (filteredCampaigns.length === 0) return;
    const headers = ['Name', 'Channel', 'Status', 'Impressions', 'Clicks', 'CTR %', 'Spend', 'Conversions', 'Conv. Value', 'ROAS', 'CPA', 'Start Date', 'End Date'];
    const rows = filteredCampaigns.map(c => [
      c.name || '', c.channel || '', c.status || '',
      c.impressions ?? '', c.clicks ?? '',
      c.impressions ? ((c.clicks || 0) / c.impressions * 100).toFixed(2) : '',
      c.amount_spent ?? '', getDisplayConversions(c), getDisplayConversionValue(c),
      c.amount_spent ? (getDisplayConversionValue(c) / c.amount_spent).toFixed(2) : '',
      getDisplayConversions(c) ? ((c.amount_spent || 0) / getDisplayConversions(c)).toFixed(2) : '',
      c.start_date || '', c.end_date || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `campaigns_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredCampaigns]);

  // Compute date-range-aware metrics per campaign
  const campaignsWithDateMetrics = useMemo(() => {
    const useDateFilter = !!(dateFrom || dateTo);
    if (!useDateFilter) return filteredCampaigns;

    const fromDate = dateFrom || '0000-00-00';
    const toDate = dateTo || '9999-99-99';

    return filteredCampaigns.map(c => {
      if (!c.dailyMetrics || Object.keys(c.dailyMetrics).length === 0) return c;
      let impressions = 0, clicks = 0, conversions = 0, amount_spent = 0, conversion_value = 0;
      const dateConvActions: Record<string, { conversions: number; value: number }> = {};
      const countedConvMonths = new Set<string>();

      for (const [date, m] of Object.entries(c.dailyMetrics)) {
        const frac = bucketOverlapFraction(date, fromDate, toDate);
        if (frac <= 0) continue;

        impressions += Math.round((m.impressions || 0) * frac);
        clicks += Math.round((m.clicks || 0) * frac);
        conversions += (m.conversions || 0) * frac;
        amount_spent += (m.amount_spent || 0) * frac;
        conversion_value += (m.conversion_value || 0) * frac;

        const mAny = m as Record<string, any>;
        if (mAny.conversionActions && typeof mAny.conversionActions === 'object') {
          const monthKey = date.slice(0, 7);
          if (!countedConvMonths.has(monthKey)) {
            countedConvMonths.add(monthKey);
            for (const [label, vals] of Object.entries(mAny.conversionActions as Record<string, { conversions: number; value: number }>)) {
              if (!dateConvActions[label]) dateConvActions[label] = { conversions: 0, value: 0 };
              dateConvActions[label].conversions += (vals.conversions || 0) * frac;
              dateConvActions[label].value += (vals.value || 0) * frac;
            }
          }
        }
      }

      // Date filter active: always use date-filtered conversionActions only
      const conversionActions = dateConvActions;

      const ctr = impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0;
      const roas = amount_spent > 0 ? Math.round((conversion_value / amount_spent) * 100) / 100 : 0;
      amount_spent = Math.round(amount_spent * 100) / 100;
      return { ...c, impressions, clicks, conversions, amount_spent, conversion_value, ctr, roas, conversionActions };
    });
  }, [filteredCampaigns, dateFrom, dateTo]);

  const applyConvFilter = (c: Campaign): Campaign => {
    if (convActionFilter.length === 0 || !c.conversionActions) return c;
    let filteredConversions = 0;
    const purchaseSelected = convActionFilter.includes('Purchase');

    for (const action of convActionFilter) {
      if (action === 'Purchase') {
        const purchaseKeys = Object.keys(c.conversionActions).filter(k => k.toLowerCase().includes('purchase'));
        const priority = ['Purchase (Pixel)', 'Purchase Completed (Google Ads)'];
        const picked = purchaseKeys.find(k => priority.includes(k)) || purchaseKeys[0];
        if (picked) {
          filteredConversions += c.conversionActions[picked].conversions;
        }
      } else {
        if (purchaseSelected && action.toLowerCase().includes('purchase')) continue;
        const a = c.conversionActions[action];
        if (a) {
          filteredConversions += a.conversions;
        }
      }
    }

    // Derive conversion_value proportionally from exact general metrics
    // to avoid discrepancies between per-action and aggregate API queries
    const totalConv = c.conversions || 0;
    const ratio = totalConv > 0 ? filteredConversions / totalConv : 0;
    const conversion_value = Math.round((c.conversion_value || 0) * ratio * 100) / 100;
    const roas = (c.amount_spent || 0) > 0 ? Math.round((conversion_value / (c.amount_spent || 1)) * 100) / 100 : 0;
    return { ...c, conversions: filteredConversions, conversion_value, roas };
  };

  const campaignsWithConvFilter = useMemo(() => {
    if (convActionFilter.length === 0) return campaignsWithDateMetrics;
    return campaignsWithDateMetrics.map(applyConvFilter);
  }, [campaignsWithDateMetrics, convActionFilter]);

  const sortedCampaigns = useMemo(() => {
    if (!sortColumn) return campaignsWithConvFilter;
    const sorted = [...campaignsWithConvFilter].sort((a, b) => {
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
        case 'conversions': va = getDisplayConversions(a); vb = getDisplayConversions(b); break;
        case 'conversion_value': va = getDisplayConversionValue(a); vb = getDisplayConversionValue(b); break;
        case 'roas': va = a.roas || 0; vb = b.roas || 0; break;
      }
      if (typeof va === 'string') return sortDirection === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDirection === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return sorted;
  }, [campaignsWithConvFilter, sortColumn, sortDirection]);

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(col);
      const ascCols = ['name', 'channel'];
      setSortDirection(ascCols.includes(col) ? 'asc' : 'desc');
    }
  };

  // Summary stats derived from the already-filtered pipeline
  // (campaignsWithConvFilter has date-filtered + conv-action-filtered metrics)
  const summaryStats = useMemo(() => {
    const list = campaignsWithConvFilter;
    const total = list.length;

    let totalSpent = 0;
    let totalConversions = 0;
    let totalConversionValue = 0;

    for (const c of list) {
      totalSpent += c.amount_spent || 0;
      totalConversions += getDisplayConversions(c);
      totalConversionValue += getDisplayConversionValue(c);
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
    };
  }, [campaignsWithConvFilter]);

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
      const status = (c.status || 'active').toLowerCase();
      unique.add(status);
    });
    return Array.from(unique);
  }, [campaigns]);

  const allConversionActions = useMemo(() => {
    const actions = new Set<string>();
    campaignsWithDateMetrics.forEach(c => {
      if (c.conversionActions) {
        Object.keys(c.conversionActions).forEach(a => actions.add(a));
      }
    });
    // Add unified "Purchase" if any platform-specific purchase type exists
    const hasPurchaseVariant = Array.from(actions).some(a => a.toLowerCase().includes('purchase'));
    if (hasPurchaseVariant && !actions.has('Purchase')) {
      actions.add('Purchase');
    }
    return Array.from(actions).sort();
  }, [campaignsWithDateMetrics]);

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
        <Spinner size="lg" label="Φόρτωση campaigns…" />
      </div>
    );
  }

  if (!hasImported) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">Campaigns</h2>
          <p className="text-[#4A4A4A] mt-1">
            Διαχείριση και ανάλυση marketing campaigns
          </p>
        </div>
        <Card padding="lg" className="text-center py-12 space-y-3">
          <p className="text-[#4A4A4A]">
            Δεν υπάρχουν imported campaigns ακόμα.
          </p>
          {connectorsStatusPending ? (
            <p className="text-sm text-[#6B7280]">Έλεγχος σύνδεσης πλατφόρμων…</p>
          ) : hasConnectedAdsOrMeta ? (
            <p className="text-sm text-[#4A4A4A] max-w-xl mx-auto">
              Η σύνδεση Google Ads / Meta δεν εισάγει αυτόματα campaigns στη λίστα. Ανοίξτε το{' '}
              <button
                type="button"
                onClick={() => onSectionChange?.('data-campaigns')}
                className="font-semibold text-[var(--nts-accent)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-1 rounded"
              >
                Data Import
              </button>
              {' '}
              και πατήστε <strong className="font-semibold text-[#1A1A1A]">Sync τώρα</strong> για κάθε
              πλατφόρμα (ή περιμένετε το προγραμματισμένο ημερήσιο sync).
            </p>
          ) : (
            <p className="text-sm text-[#4A4A4A]">
              Μεταβείτε στο{' '}
              <button
                type="button"
                onClick={() => onSectionChange?.('data-campaigns')}
                className="font-semibold text-[var(--nts-accent)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-1 rounded"
              >
                Data Import
              </button>
              {' '}
              για να συνδέσετε Google Ads ή Meta και να εισάγετε campaigns.
            </p>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">Campaigns</h2>
          <p className="text-[#4A4A4A] mt-1">
            {summaryStats.total} {summaryStats.total === 1 ? 'campaign' : 'campaigns'} imported
          </p>
          {import.meta.env.MODE === 'development' && (() => {
            const bySource: Record<string, number> = {};
            (campaigns as Campaign[]).forEach(c => {
              const source = (c as any).source || 'Unknown';
              bySource[source] = (bySource[source] || 0) + 1;
            });
            return (
              <p className="text-xs text-[#9CA3AF] mt-1">
                Sources: {Object.entries(bySource).map(([src, count]) => `${src}: ${count}`).join(', ')}
              </p>
            );
          })()}
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            icon={<Trash2 size={16} />}
            onClick={handleDeleteCampaigns}
            disabled={isDeleting || !hasImported}
            className="text-[#DC2626] hover:bg-[#FEE2E2]"
          >
            {isDeleting ? 'Διαγραφή…' : 'Διαγραφή δεδομένων'}
          </Button>
          <Button variant="secondary" icon={<Download size={16} />} onClick={handleExportCampaigns} disabled={filteredCampaigns.length === 0}>
            Export .csv
          </Button>
        </div>
      </div>

      {/* Automation Alerts */}
      <AlertsBanner filterGroup="campaigns" maxAlerts={3} onNavigate={onSectionChange} />

      {/* Tabs */}
      <div className="flex gap-1 bg-[#F5F5F5] p-1 rounded-lg w-fit">
        {(['campaigns', 'search_terms', 'keywords'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === tab
                ? 'bg-white text-[#111827] shadow-sm'
                : 'text-[#6B7280] hover:text-[#111827]'
            }`}
          >
            {tab === 'campaigns' ? `Campaigns (${summaryStats.total})` :
             tab === 'search_terms' ? `Search Terms ${hasSearchData ? `(${searchTerms.length})` : ''}` :
             `Keywords ${hasSearchData ? `(${keywords.length})` : ''}`}
          </button>
        ))}
      </div>

      {activeTab !== 'campaigns' && (
        <SearchIntelligenceTab
          type={activeTab}
          searchTerms={searchTerms}
          keywords={keywords}
          hasData={hasSearchData}
          search={activeTab === 'search_terms' ? stSearch : kwSearch}
          onSearchChange={activeTab === 'search_terms' ? setStSearch : setKwSearch}
        />
      )}

      {activeTab === 'campaigns' && <>
      {/* Date range picker */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onChange={(f, t) => { setDateFrom(f); setDateTo(t); }}
          onClear={() => { setDateFrom(''); setDateTo(''); localStorage.removeItem(LS_FROM); localStorage.removeItem(LS_TO); }}
        />
        <span className="text-xs text-[#9CA3AF]">
          Δεδομένα έως 3 χρόνια ιστορικού
        </span>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card padding="md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#4A4A4A] flex items-center gap-1">Total Spent <Tooltip content="Συνολικό ποσό που δαπανήθηκε σε διαφημίσεις εντός του επιλεγμένου εύρους ημερομηνιών." size={13} /></p>
              <p className="text-2xl font-bold text-[#1A1A1A] font-mono mt-1">
                €{formatCurrency(summaryStats.totalSpent, 2)}
              </p>
            </div>
            <div className="w-12 h-12 bg-[var(--nts-light-gray)] rounded-lg flex items-center justify-center">
              <DollarSign size={24} className="text-[var(--nts-accent)]" />
            </div>
          </div>
        </Card>

        <Card padding="md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#4A4A4A] flex items-center gap-1">Total Conversions <Tooltip content="Αριθμός μετατροπών (αγορές, leads) που αποδίδονται στις καμπάνιες εντός της επιλεγμένης περιόδου." size={13} /></p>
              <p className="text-2xl font-bold text-[#1A1A1A] font-mono mt-1">
                {formatConvCount(summaryStats.totalConversions)}
              </p>
            </div>
            <div className="w-12 h-12 bg-[#DCFCE7] rounded-lg flex items-center justify-center">
              <TrendingUp size={24} className="text-[#22C55E]" />
            </div>
          </div>
        </Card>

        <Card padding="md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#4A4A4A] flex items-center gap-1">Conversion Value <Tooltip content="Συνολική αξία (€) των μετατροπών που αποδίδονται στις καμπάνιες." size={13} /></p>
              <p className="text-2xl font-bold text-[#1A1A1A] font-mono mt-1">
                €{formatCurrency(summaryStats.totalConversionValue, 2)}
              </p>
            </div>
            <div className="w-12 h-12 bg-[#F5F5F5] rounded-lg flex items-center justify-center">
              <TrendingUp size={24} className="text-[#4A4A4A]" />
            </div>
          </div>
        </Card>

        <Card padding="md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#4A4A4A] flex items-center gap-1">Avg ROAS <Tooltip content="Μέσο Return on Ad Spend εντός περιόδου: Αξία Μετατροπών ÷ Spend." size={13} /></p>
              <p className="text-2xl font-bold text-[#1A1A1A] font-mono mt-1">
                {formatMultiplier(summaryStats.avgROAS, 0)}
              </p>
            </div>
            <div className="w-12 h-12 bg-[#FEF3C7] rounded-lg flex items-center justify-center">
              <TrendingUp size={24} className="text-[#F59E0B]" />
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card padding="md">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4A4A4A]" />
              <input
                type="text"
                placeholder="Αναζήτηση campaigns..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)] focus:bg-white transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Filter size={18} className="text-[#4A4A4A]" />
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="px-3 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)] focus:bg-white transition-all"
            >
              <option value="all">Όλα τα Channels</option>
              {channels.map(ch => (
                <option key={ch} value={ch}>{ch}</option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)] focus:bg-white transition-all"
            >
              <option value="all">Όλα τα Status</option>
              <option value="active">Ενεργά</option>
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
                    : 'Conversion Type'}
                </button>
                {showConvDropdown && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowConvDropdown(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-[#E5E5E5] rounded-xl shadow-lg py-2 min-w-[220px] max-h-[320px] overflow-y-auto">
                      <div className="px-3 py-1.5 border-b border-[#F0F0F0] flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Conversion Actions</span>
                        {convActionFilter.length > 0 && (
                          <button onClick={clearConvFilter} className="text-[10px] text-[var(--nts-accent)] hover:underline">Clear</button>
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
      <Card padding="lg">
        <div className="flex items-center justify-between">
          <CardHeader
            title="Campaigns List"
            subtitle={`${filteredCampaigns.length} ${filteredCampaigns.length === 1 ? 'campaign' : 'campaigns'}`}
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
            <p className="text-[#4A4A4A]">Δεν βρέθηκαν campaigns με τα επιλεγμένα filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto mt-4">
            <table className="w-full">
              <thead>
                <tr className="text-left text-[11px] text-[#4A4A4A] border-b border-[#E5E5E5]">
                  <SortableHeader col="name" label="Campaign" current={sortColumn} dir={sortDirection} onSort={handleSort} className="" />
                  <SortableHeader col="channel" label="Channel" current={sortColumn} dir={sortDirection} onSort={handleSort} className="whitespace-nowrap" />
                  <SortableHeader col="status" label="Status" current={sortColumn} dir={sortDirection} onSort={handleSort} className="whitespace-nowrap hidden md:table-cell" />
                  <SortableHeader col="impressions" label="Impr." current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap hidden lg:table-cell" />
                  <SortableHeader col="clicks" label="Clicks" current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap hidden md:table-cell" />
                  <SortableHeader col="ctr" label="CTR" current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap hidden lg:table-cell" />
                  <SortableHeader col="conversions" label="Conv." current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap hidden sm:table-cell" />
                  <SortableHeader col="spent" label="Spent" current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap hidden sm:table-cell" />
                  <SortableHeader col="conversion_value" label="Τζίρος" title="Conversion value" current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap hidden sm:table-cell" />
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
                      {formatConvCount(getDisplayConversions(campaign))}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap hidden sm:table-cell">
                      {campaign.amount_spent ? `€${formatCurrency(campaign.amount_spent, 2)}` : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap hidden sm:table-cell" title="Conversion value (τζίρος από conversions)">
                      €{formatCurrency(getDisplayConversionValue(campaign), 2)}
                    </td>
                    <td className="py-3 px-2 text-right">
                      {Number.isFinite(campaign.roas ?? NaN) ? (
                        <Badge variant={(campaign.roas ?? 0) > 0 ? 'success' : 'default'} size="sm">
                          {formatMultiplier(campaign.roas ?? 0, 0)}
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
      </>}
    </div>
  );
}

// ─── Search Intelligence Tab ────────────────────────────────────

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

  if (!hasData) {
    return (
      <Card padding="lg" className="text-center py-12">
        <p className="text-[#6B7280]">
          {type === 'search_terms' ? 'Search Terms' : 'Keywords'} θα εμφανιστούν μετά το επόμενο Google Ads sync.
        </p>
        <p className="text-xs text-[#9CA3AF] mt-2">Data Import → Google Ads → Sync τώρα</p>
      </Card>
    );
  }

  return (
    <Card padding="lg">
      <div className="flex items-center justify-between mb-4">
        <CardHeader
          title={type === 'search_terms' ? 'Search Terms' : 'Keywords'}
          subtitle={`${filtered.length} ${type === 'search_terms' ? 'search terms' : 'keywords'} · τελευταίες 90 ημέρες`}
        />
        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={type === 'search_terms' ? 'Αναζήτηση term...' : 'Αναζήτηση keyword...'}
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
                      ) : <span className="text-[#9CA3AF]">—</span>}
                    </td>
                  )}
                  <td className="py-2 px-2 text-[#6B7280] text-xs max-w-[180px] truncate">{item.campaign}</td>
                  <td className="py-2 px-2 text-right font-mono text-[#374151]">{item.impressions.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right font-mono text-[#374151]">{item.clicks.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right font-mono text-[#374151]">{ctr}%</td>
                  <td className="py-2 px-2 text-right font-mono text-[#374151]">{item.conversions > 0 ? item.conversions.toFixed(1) : '—'}</td>
                  <td className="py-2 px-2 text-right font-mono text-[#374151]">€{item.cost.toFixed(2)}</td>
                  <td className="py-2 px-2 text-right font-mono text-[#374151]">
                    {item.conversionValue > 0 ? `€${item.conversionValue.toFixed(2)}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-sm text-[#9CA3AF] text-center py-8">
            {search ? 'Δεν βρέθηκαν αποτελέσματα.' : 'Δεν υπάρχουν δεδομένα.'}
          </p>
        )}
        {filtered.length > 200 && (
          <p className="text-xs text-[#9CA3AF] text-center py-3">
            Εμφανίζονται τα πρώτα 200 από {filtered.length} αποτελέσματα
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
