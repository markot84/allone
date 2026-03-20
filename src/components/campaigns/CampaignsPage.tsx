import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { TrendingUp, Filter, Download, Search, Calendar, DollarSign, Trash2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { Card, CardHeader, Badge, Button, Spinner, useToast } from '../common';
import { useCampaigns, useBrand } from '../../hooks';
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

interface CampaignsPageProps {
  onSectionChange?: (section: string) => void;
}

export function CampaignsPage({ onSectionChange }: CampaignsPageProps = {}) {
  const { currentBrand } = useBrand();
  const { campaigns, isLoading, hasImported } = useCampaigns();
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

  // Filter campaigns
  const filteredCampaigns = useMemo(() => {
    let filtered = campaigns as Campaign[];

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

  const sortedCampaigns = useMemo(() => {
    if (!sortColumn) return filteredCampaigns;
    const sorted = [...filteredCampaigns].sort((a, b) => {
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
        case 'conversions': va = a.conversions || 0; vb = b.conversions || 0; break;
        case 'roas': va = a.roas || 0; vb = b.roas || 0; break;
      }
      if (typeof va === 'string') return sortDirection === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDirection === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return sorted;
  }, [filteredCampaigns, sortColumn, sortDirection]);

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(col);
      setSortDirection(col === 'name' || col === 'channel' ? 'asc' : 'desc');
    }
  };

  // Calculate summary stats (from filtered campaigns)
  const summaryStats = useMemo(() => {
    const list = filteredCampaigns;
    const total = list.length;
    const totalSpent = list.reduce((sum, c) => sum + (c.amount_spent || 0), 0);
    const totalConversions = list.reduce((sum, c) => sum + (c.conversions || 0), 0);
    const totalConversionValue = list.reduce((sum, c) => sum + (c.conversion_value || 0), 0);
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
  }, [filteredCampaigns]);

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
        <Card padding="lg" className="text-center py-12">
          <p className="text-[#4A4A4A] mb-4">
            Δεν υπάρχουν imported campaigns ακόμα.
          </p>
          <p className="text-sm text-[#4A4A4A]">
            Μεταβείτε στο{' '}
            <button
              type="button"
              onClick={() => onSectionChange?.('data-campaigns')}
              className="font-semibold text-[var(--nts-accent)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-1 rounded"
            >
              Data Import
            </button>
            {' '}για να εισάγετε campaigns από Google Ads ή Meta.
          </p>
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
          <Button variant="secondary" icon={<Download size={16} />}>
            Export
          </Button>
        </div>
      </div>

      {/* Date range tab */}
      <Card padding="md" className="border-l-4 border-l-[var(--nts-accent)]">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-[var(--nts-accent)]" />
            <span className="text-sm font-medium text-[#4A4A4A]">Περίοδος δεδομένων:</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#9CA3AF]">Από</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-1.5 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)] focus:bg-white transition-all"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#9CA3AF]">Έως</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-1.5 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)] focus:bg-white transition-all"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); localStorage.removeItem(LS_FROM); localStorage.removeItem(LS_TO); }}
                className="text-xs text-[var(--nts-accent)] hover:underline"
              >
                Καθαρισμός
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card padding="md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#4A4A4A]">Total Spent</p>
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
              <p className="text-sm text-[#4A4A4A]">Total Conversions</p>
              <p className="text-2xl font-bold text-[#1A1A1A] font-mono mt-1">
                {formatNumber(summaryStats.totalConversions)}
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
              <p className="text-sm text-[#4A4A4A]">Conversion Value</p>
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
              <p className="text-sm text-[#4A4A4A]">Avg ROAS</p>
              <p className="text-2xl font-bold text-[#1A1A1A] font-mono mt-1">
                {formatMultiplier(summaryStats.avgROAS, 2)}
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
          </div>
        </div>
      </Card>

      {/* Campaigns Table */}
      <Card padding="lg">
        <CardHeader
          title="Campaigns List"
          subtitle={`${filteredCampaigns.length} ${filteredCampaigns.length === 1 ? 'campaign' : 'campaigns'}`}
        />

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
                  <SortableHeader col="period" label="Period" current={sortColumn} dir={sortDirection} onSort={handleSort} className="whitespace-nowrap hidden lg:table-cell" />
                  <SortableHeader col="status" label="Status" current={sortColumn} dir={sortDirection} onSort={handleSort} className="whitespace-nowrap hidden md:table-cell" />
                  <SortableHeader col="spent" label="Spent" current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap" />
                  <SortableHeader col="impressions" label="Impr." current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap hidden lg:table-cell" />
                  <SortableHeader col="clicks" label="Clicks" current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap hidden md:table-cell" />
                  <SortableHeader col="ctr" label="CTR" current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap hidden lg:table-cell" />
                  <SortableHeader col="conversions" label="Conv." current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap hidden sm:table-cell" />
                  <SortableHeader col="roas" label="ROAS" current={sortColumn} dir={sortDirection} onSort={handleSort} align="right" className="whitespace-nowrap" />
                </tr>
              </thead>
              <tbody>
                {sortedCampaigns.map((campaign, index) => (
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
                    <td className="py-2 px-3 text-xs text-[#4A4A4A] whitespace-nowrap hidden lg:table-cell">
                      {campaign.period || '-'}
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
                    <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap">
                      {campaign.amount_spent ? `€${formatCurrency(campaign.amount_spent, 2)}` : '-'}
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
                      {campaign.conversions ? formatNumber(campaign.conversions) : '-'}
                    </td>
                    <td className="py-3 px-2 text-right">
                      {campaign.roas ? (
                        <Badge variant="success" size="sm">
                          {formatMultiplier(campaign.roas, 2)}
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
    </div>
  );
}

function SortableHeader({ col, label, current, dir, onSort, align, className = '' }: {
  col: string; label: string; current: string | null; dir: 'asc' | 'desc'; onSort: (col: string) => void; align?: 'right'; className?: string;
}) {
  const active = current === col;
  return (
    <th
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
