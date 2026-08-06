import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { BarChart3 } from 'lucide-react';
import { Card, CardHeader } from '../common';
import { formatCurrencyCompact, formatNumber, formatPercent } from '../../utils/format';
import { calculateChannelPerformance } from '../../utils/roiUtils';
import type { Campaign } from '../../types';

const CHANNEL_DOT_COLORS: Record<string, string> = {
  'Google Ads': '#4285F4',
  Meta: '#1877F2',
  Other: 'var(--text-muted)',
  'Google Shopping': '#34A853',
  Facebook: '#1877F2',
  Instagram: '#E4405F',
  TikTok: '#000000',
  Email: '#F59E0B',
  SMS: '#8B5CF6',
};

export function CampaignsChannelInsights({ campaigns }: { campaigns: Campaign[] }) {
  const channelPerf = useMemo(() => calculateChannelPerformance(campaigns), [campaigns]);

  if (channelPerf.length === 0) return null;

  return (
    <Card padding="md">
      <CardHeader
        className="!mb-3 !gap-2"
        title="Απόδοση ανά Κανάλι"
        subtitle="Σύγκριση ROAS, spend και conversions"
        icon={<BarChart3 size={18} className="text-[var(--nts-accent-text)]" />}
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
                style={{ backgroundColor: CHANNEL_DOT_COLORS[ch.channel] || 'var(--text-muted)' }}
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
  );
}
