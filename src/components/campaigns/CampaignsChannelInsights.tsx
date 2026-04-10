import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Target } from 'lucide-react';
import { Card, CardHeader, Badge } from '../common';
import { formatCurrencyCompact, formatNumber, formatPercent } from '../../utils/format';
import {
  calculateChannelPerformance,
  getEffectiveConversionValue,
} from '../../utils/roiUtils';
import type { Campaign } from '../../types';

const CHANNEL_DOT_COLORS: Record<string, string> = {
  'Google Ads': '#4285F4',
  Meta: '#1877F2',
  Other: '#78716C',
  'Google Shopping': '#34A853',
  Facebook: '#1877F2',
  Instagram: '#E4405F',
  TikTok: '#000000',
  Email: '#F59E0B',
  SMS: '#8B5CF6',
};

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

function CampaignStatusBadge({ status }: { status?: string }) {
  const s = (status || '').toLowerCase();
  if (s === 'active' || s === 'enabled') return <Badge variant="success" size="sm">Active</Badge>;
  if (s === 'paused') return <Badge variant="warning" size="sm">Paused</Badge>;
  if (s === 'completed' || s === 'removed') return <Badge variant="default" size="sm">Ended</Badge>;
  return <Badge variant="default" size="sm">{status || '—'}</Badge>;
}

export function CampaignsChannelInsights({ campaigns }: { campaigns: Campaign[] }) {
  const [channelFilter, setChannelFilter] = useState<string>('all');

  const channelPerf = useMemo(() => calculateChannelPerformance(campaigns), [campaigns]);

  const availableChannels = useMemo(() => {
    const seen = new Set<string>();
    for (const c of campaigns) {
      if (c.channel) seen.add(c.channel);
    }
    return Array.from(seen).sort();
  }, [campaigns]);

  const topCampaigns = useMemo(() => {
    const filtered = channelFilter === 'all'
      ? campaigns
      : campaigns.filter(c => c.channel === channelFilter);
    return [...filtered]
      .filter(c => (c.amount_spent || 0) > 0)
      .sort((a, b) => (b.roas || 0) - (a.roas || 0))
      .slice(0, 10);
  }, [campaigns, channelFilter]);

  return (
    <>
      {channelPerf.length > 0 && (
        <Card padding="md">
          <CardHeader
            className="!mb-3 !gap-2"
            title="Απόδοση ανά Κανάλι"
            subtitle="Σύγκριση ROAS, spend και conversions"
            icon={<BarChart3 size={18} className="text-[var(--nts-accent)]" />}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-2">
            {channelPerf.map((ch, i) => (
              <motion.div
                key={ch.channel}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="p-3 rounded-lg border border-[var(--nts-border-gray)] bg-white hover:shadow-sm transition-shadow"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: CHANNEL_DOT_COLORS[ch.channel] || '#78716C' }}
                  />
                  <span className="font-medium text-[var(--nts-charcoal)] text-sm">{ch.channel}</span>
                  <span className="text-xs text-[var(--nts-medium-gray)] ml-auto">
                    {ch.campaignCount} campaign{ch.campaignCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] text-[var(--nts-medium-gray)] uppercase tracking-wider">Spend</p>
                    <p className="text-sm font-bold font-mono text-[var(--nts-charcoal)]">
                      {formatCurrencyCompact(ch.spent)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--nts-medium-gray)] uppercase tracking-wider">Revenue</p>
                    <p className="text-sm font-bold font-mono text-[var(--nts-charcoal)]">
                      {formatCurrencyCompact(ch.revenue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--nts-medium-gray)] uppercase tracking-wider">ROAS</p>
                    <p className={`text-sm font-bold font-mono ${ch.roas >= 1 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
                      {ch.roas > 0 ? `${formatNumber(ch.roas, 2)}x` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--nts-medium-gray)] uppercase tracking-wider">Conv.</p>
                    <p className="text-sm font-mono text-[var(--nts-charcoal)]">{formatNumber(ch.conversions)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--nts-medium-gray)] uppercase tracking-wider">CPA</p>
                    <p className="text-sm font-mono text-[var(--nts-charcoal)]">
                      {ch.cpa > 0 ? `€${formatNumber(ch.cpa, 2)}` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--nts-medium-gray)] uppercase tracking-wider">CTR</p>
                    <p className="text-sm font-mono text-[var(--nts-charcoal)]">
                      {ch.ctr > 0 ? formatPercent(ch.ctr) : '—'}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </Card>
      )}

      {(topCampaigns.length > 0 || channelFilter !== 'all') && (
        <Card padding="md">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
            <CardHeader
              className="!mb-0 !gap-2"
              title="Top Campaigns"
              subtitle="Ταξινόμηση κατά ROAS"
              icon={<Target size={18} className="text-[var(--nts-accent)]" />}
            />
            {availableChannels.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setChannelFilter('all')}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    channelFilter === 'all'
                      ? 'bg-[var(--nts-charcoal)] text-white border-[var(--nts-charcoal)]'
                      : 'bg-white text-[var(--nts-medium-gray)] border-[var(--nts-border-gray)] hover:border-[var(--nts-charcoal)] hover:text-[var(--nts-charcoal)]'
                  }`}
                >
                  Όλα
                </button>
                {availableChannels.map(ch => {
                  const c = CHANNEL_COLORS[ch] || DEFAULT_CHANNEL_COLOR;
                  const active = channelFilter === ch;
                  return (
                    <button
                      key={ch}
                      onClick={() => setChannelFilter(ch)}
                      className="px-3 py-1 rounded-full text-xs font-medium border transition-colors"
                      style={
                        active
                          ? { backgroundColor: c.text, color: '#fff', borderColor: c.text }
                          : { backgroundColor: c.bg, color: c.text, borderColor: c.border }
                      }
                    >
                      {ch}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="overflow-x-auto mt-1">
            <table className="w-full" style={{ minWidth: 700 }}>
              <thead>
                <tr className="text-left text-xs text-[var(--nts-medium-gray)] border-b border-[var(--nts-border-gray)]">
                  <th className="pb-3 font-medium" style={{ width: '30%' }}>Campaign</th>
                  <th className="pb-3 font-medium" style={{ width: '12%' }}>Κανάλι</th>
                  <th className="pb-3 font-medium text-right" style={{ width: '12%' }}>Spend</th>
                  <th className="pb-3 font-medium text-right" style={{ width: '12%' }}>Revenue</th>
                  <th className="pb-3 font-medium text-right" style={{ width: '10%' }}>ROAS</th>
                  <th className="pb-3 font-medium text-right" style={{ width: '10%' }}>Conv.</th>
                  <th className="pb-3 font-medium text-center" style={{ width: '10%' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {topCampaigns.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-sm text-[var(--nts-medium-gray)]">
                      Δεν υπάρχουν campaigns για το επιλεγμένο κανάλι.
                    </td>
                  </tr>
                )}
                {topCampaigns.map((c, index) => (
                  <motion.tr
                    key={c.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.03 }}
                    className="border-b border-[var(--nts-border-gray)] last:border-0 hover:bg-[var(--nts-light-gray)]"
                  >
                    <td className="py-3 pr-3">
                      <span className="text-sm font-medium text-[var(--nts-charcoal)] truncate block max-w-[280px]" title={c.name}>
                        {c.name}
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      <ChannelBadge channel={c.channel || 'Other'} />
                    </td>
                    <td className="py-3 text-right font-mono text-sm pr-3">
                      {formatCurrencyCompact(c.amount_spent || 0)}
                    </td>
                    <td className="py-3 text-right font-mono text-sm font-bold pr-3">
                      {formatCurrencyCompact(getEffectiveConversionValue(c))}
                    </td>
                    <td className="py-3 text-right pr-3">
                      {(() => {
                        const cv = getEffectiveConversionValue(c);
                        const spent = c.amount_spent || 0;
                        const roas = spent > 0 && cv > 0 ? cv / spent : 0;
                        return (
                          <span className={`font-mono text-sm font-bold ${roas >= 1 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
                            {roas > 0 ? `${formatNumber(roas, 2)}x` : '—'}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-3 text-right font-mono text-sm pr-3">
                      {formatNumber(c.conversions || 0)}
                    </td>
                    <td className="py-3 text-center">
                      <CampaignStatusBadge status={c.status} />
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
