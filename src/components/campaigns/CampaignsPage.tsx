import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Filter, Download, Search, Calendar, DollarSign } from 'lucide-react';
import { Card, CardHeader, Badge, Button, Spinner } from '../common';
import { useCampaigns } from '../../hooks';
import type { Campaign } from '../../types';

export function CampaignsPage() {
  const { campaigns, isLoading, hasImported } = useCampaigns();
  const [searchQuery, setSearchQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

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

    // Channel filter
    if (channelFilter !== 'all') {
      filtered = filtered.filter(c => c.channel === channelFilter);
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

    return filtered;
  }, [campaigns, searchQuery, channelFilter, statusFilter]);

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    const total = (campaigns as Campaign[]).length;
    const totalSpent = (campaigns as Campaign[]).reduce((sum, c) => sum + (c.amount_spent || 0), 0);
    const totalConversions = (campaigns as Campaign[]).reduce((sum, c) => sum + (c.conversions || 0), 0);
    const totalConversionValue = (campaigns as Campaign[]).reduce((sum, c) => sum + (c.conversion_value || 0), 0);
    const avgROAS = totalSpent > 0 ? totalConversionValue / totalSpent : 0;

    const byChannel: Record<string, number> = {};
    (campaigns as Campaign[]).forEach(c => {
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
  }, [campaigns]);

  // Get unique channels and statuses
  const channels = useMemo(() => {
    const unique = new Set<string>();
    (campaigns as Campaign[]).forEach(c => {
      if (c.channel) unique.add(c.channel);
    });
    return Array.from(unique);
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
            Μεταβείτε στο <strong>Data Import</strong> για να εισάγετε campaigns από Google Ads ή Meta.
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
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" icon={<Download size={16} />}>
            Export
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card padding="md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#4A4A4A]">Total Spent</p>
              <p className="text-2xl font-bold text-[#1A1A1A] font-mono mt-1">
                €{summaryStats.totalSpent.toLocaleString()}
              </p>
            </div>
            <div className="w-12 h-12 bg-[#FFF0EB] rounded-lg flex items-center justify-center">
              <DollarSign size={24} className="text-[#FF6B35]" />
            </div>
          </div>
        </Card>

        <Card padding="md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#4A4A4A]">Total Conversions</p>
              <p className="text-2xl font-bold text-[#1A1A1A] font-mono mt-1">
                {summaryStats.totalConversions.toLocaleString()}
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
                €{summaryStats.totalConversionValue.toLocaleString()}
              </p>
            </div>
            <div className="w-12 h-12 bg-[#DBEAFE] rounded-lg flex items-center justify-center">
              <TrendingUp size={24} className="text-[#3B82F6]" />
            </div>
          </div>
        </Card>

        <Card padding="md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#4A4A4A]">Avg ROAS</p>
              <p className="text-2xl font-bold text-[#1A1A1A] font-mono mt-1">
                {summaryStats.avgROAS.toFixed(2)}x
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
                className="w-full pl-10 pr-4 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[#FF6B35] focus:bg-white transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Filter size={18} className="text-[#4A4A4A]" />
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="px-3 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[#FF6B35] focus:bg-white transition-all"
            >
              <option value="all">Όλα τα Channels</option>
              {channels.map(ch => (
                <option key={ch} value={ch}>{ch}</option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[#FF6B35] focus:bg-white transition-all"
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
                <tr className="text-left text-xs text-[#4A4A4A] border-b border-[#E5E5E5]">
                  <th className="pb-3 font-medium px-2">Campaign Name</th>
                  <th className="pb-3 font-medium px-2">Channel</th>
                  <th className="pb-3 font-medium px-2">Period</th>
                  <th className="pb-3 font-medium px-2">Status</th>
                  <th className="pb-3 font-medium px-2 text-right">Spent</th>
                  <th className="pb-3 font-medium px-2 text-right">Impressions</th>
                  <th className="pb-3 font-medium px-2 text-right">Clicks</th>
                  <th className="pb-3 font-medium px-2 text-right">CTR</th>
                  <th className="pb-3 font-medium px-2 text-right">Conversions</th>
                  <th className="pb-3 font-medium px-2 text-right">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {filteredCampaigns.map((campaign, index) => (
                  <motion.tr
                    key={campaign.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className="border-b border-[#E5E5E5] hover:bg-[#F5F5F5] transition-colors"
                  >
                    <td className="py-3 px-2">
                      <div className="font-medium text-[#1A1A1A]">{campaign.name}</div>
                      {campaign.start_date && campaign.end_date && (
                        <div className="text-xs text-[#4A4A4A] mt-1 flex items-center gap-1">
                          <Calendar size={12} />
                          {campaign.start_date} - {campaign.end_date}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-2">
                      <Badge variant="default" size="sm">{campaign.channel || 'Other'}</Badge>
                    </td>
                    <td className="py-3 px-2 text-sm text-[#4A4A4A]">
                      {campaign.period || '-'}
                    </td>
                    <td className="py-3 px-2">
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
                    <td className="py-3 px-2 text-right font-mono text-sm">
                      {campaign.amount_spent ? `€${campaign.amount_spent.toLocaleString()}` : '-'}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-sm">
                      {campaign.impressions ? campaign.impressions.toLocaleString() : '-'}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-sm">
                      {campaign.clicks ? campaign.clicks.toLocaleString() : '-'}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-sm">
                      {campaign.ctr ? `${campaign.ctr.toFixed(2)}%` : '-'}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-sm">
                      {campaign.conversions ? campaign.conversions.toLocaleString() : '-'}
                    </td>
                    <td className="py-3 px-2 text-right">
                      {campaign.roas ? (
                        <Badge variant="success" size="sm">
                          {campaign.roas.toFixed(2)}x
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
