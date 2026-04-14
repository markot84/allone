import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Zap, Target, Users, MessageSquare, TrendingUp } from 'lucide-react';
import { Badge, FormattedProse } from '../common';
import type { ChannelRecommendation, RFMSegment } from '../../types';
import { formatBudgetChannelLabel, budgetKeyMatchesListedChannel } from '../../utils/budgetChannelLabels';

const FUNNEL_STAGE: Record<string, { label: string; color: string }> = {
  'google search ads': { label: 'Μετατροπή', color: '#22C55E' },
  'google shopping': { label: 'Μετατροπή', color: '#22C55E' },
  'google performance max': { label: 'Πλήρες funnel', color: '#6B7280' },
  'meta ads (facebook/instagram)': { label: 'Επίγνωση', color: '#3B82F6' },
  'meta ads': { label: 'Επίγνωση', color: '#3B82F6' },
  'youtube ads': { label: 'Σκέψη', color: '#F97316' },
  'google display network': { label: 'Επίγνωση', color: '#3B82F6' },
  'video/connected tv': { label: 'Επίγνωση', color: '#3B82F6' },
  'programmatic display': { label: 'Επίγνωση', color: '#3B82F6' },
  'email marketing': { label: 'Αφοσίωση', color: '#8B5CF6' },
  'sms marketing': { label: 'Αφοσίωση', color: '#8B5CF6' },
  'sms': { label: 'Αφοσίωση', color: '#8B5CF6' },
  'push notifications': { label: 'Αφοσίωση', color: '#8B5CF6' },
  'loyalty programs': { label: 'Αφοσίωση', color: '#8B5CF6' },
  'dynamic remarketing': { label: 'Μετατροπή', color: '#22C55E' },
  'meta retargeting': { label: 'Μετατροπή', color: '#22C55E' },
  'google remarketing': { label: 'Μετατροπή', color: '#22C55E' },
  'remarketing': { label: 'Μετατροπή', color: '#22C55E' },
  'organic social media': { label: 'Επίγνωση', color: '#3B82F6' },
  'influencer marketing': { label: 'Σκέψη', color: '#F97316' },
  'content marketing/seo': { label: 'Σκέψη', color: '#F97316' },
  'content marketing': { label: 'Σκέψη', color: '#F97316' },
  'seo (on-page & technical)': { label: 'Σκέψη', color: '#F97316' },
  'seo': { label: 'Σκέψη', color: '#F97316' },
  'blog / editorial content': { label: 'Επίγνωση', color: '#3B82F6' },
  'blog': { label: 'Επίγνωση', color: '#3B82F6' },
  'product content optimization': { label: 'Μετατροπή', color: '#22C55E' },
  'ugc (user-generated content)': { label: 'Σκέψη', color: '#F97316' },
  'ugc': { label: 'Σκέψη', color: '#F97316' },
  'marketplace ads (skroutz, amazon)': { label: 'Μετατροπή', color: '#22C55E' },
  'marketplace ads (skroutz)': { label: 'Μετατροπή', color: '#22C55E' },
  'affiliate marketing': { label: 'Μετατροπή', color: '#22C55E' },
  'tiktok ads': { label: 'Επίγνωση', color: '#3B82F6' },
  'pinterest ads': { label: 'Σκέψη', color: '#F97316' },
  'whatsapp business': { label: 'Αφοσίωση', color: '#8B5CF6' },
};

function getFunnelStage(channel: string) {
  const key = channel.toLowerCase().trim();
  if (FUNNEL_STAGE[key]) return FUNNEL_STAGE[key];
  for (const [k, v] of Object.entries(FUNNEL_STAGE)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return { label: 'Άλλο', color: '#9CA3AF' };
}

function getBudgetForChannel(channel: string, allocation: Record<string, number>): number | null {
  const lower = channel.toLowerCase().trim();
  for (const [key, val] of Object.entries(allocation)) {
    const k = key.toLowerCase();
    if (k === lower) return val;
    if (lower.includes(k) || k.includes(lower.split(' ')[0])) return val;
    const normalized = lower.replace(/[^a-z]/g, '');
    const normalizedKey = k.replace(/[^a-z]/g, '');
    if (normalized.startsWith(normalizedKey) || normalizedKey.startsWith(normalized.slice(0, 5))) return val;
  }
  return null;
}

interface ChannelRecommendationsProps {
  recommendations: ChannelRecommendation | null;
  segment: RFMSegment | null;
}

export function ChannelRecommendations({
  recommendations,
  segment
}: ChannelRecommendationsProps) {
  if (!segment) {
    return (
      <div className="p-8 text-center text-[#4A4A4A]">
        <p>Φόρτωσε RFM segments για να δεις συστάσεις καναλιών.</p>
      </div>
    );
  }
  if (!recommendations) {
    return (
      <div className="p-8 text-center text-[#4A4A4A]">
        <p>Δεν υπάρχουν διαθέσιμες συστάσεις για αυτό το segment.</p>
      </div>
    );
  }

  const orphanBudgetChannels = useMemo(() => {
    const listed = [...recommendations.primary, ...recommendations.secondary];
    return Object.entries(recommendations.budget_allocation)
      .filter(([key]) => !listed.some((ch) => budgetKeyMatchesListedChannel(key, ch)))
      .sort((a, b) => b[1] - a[1]);
  }, [recommendations]);

  return (
    <div className="space-y-6">
      {/* Segment Info */}
      <div className="flex items-center gap-4 p-4 rounded-lg" style={{ backgroundColor: `${segment.color}15` }}>
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
          style={{ backgroundColor: `${segment.color}25` }}
        >
          {/* no emoji icons in enterprise UI */}
        </div>
        <div className="flex-1">
          <h4 className="font-semibold text-[#1A1A1A]">Τμήμα: {segment.name}</h4>
          <p className="text-sm text-[#4A4A4A]">{segment.description}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-[#4A4A4A]">Πελάτες</p>
          <p className="text-lg font-bold text-[#1A1A1A] font-mono">
            {segment.count.toLocaleString()}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-[#4A4A4A]">Μερίδιο εσόδων</p>
          <p className="text-lg font-bold font-mono" style={{ color: segment.color }}>
            {segment.revenue_share}%
          </p>
        </div>
      </div>

      {/* Budget Allocation Visualization — πάνω από Κύρια κανάλια */}
      <div>
        <h5 className="text-sm font-medium text-[#1A1A1A] mb-3">
          Budget Allocation
        </h5>
        <div className="flex h-4 rounded-full overflow-hidden">
          {Object.entries(recommendations.budget_allocation).map(
            ([channel, percentage], index) => {
              const colors = ['var(--nts-accent)', '#78716C', '#22C55E', '#8B5CF6', '#F59E0B'];
              return (
                <motion.div
                  key={channel}
                  initial={{ width: 0 }}
                  animate={{ width: `${percentage}%` }}
                  transition={{ delay: 0.5 + index * 0.1 }}
                  className="h-full"
                  style={{ backgroundColor: colors[index % colors.length] }}
                  title={`${formatBudgetChannelLabel(channel)}: ${percentage}%`}
                />
              );
            }
          )}
        </div>
        <div className="flex flex-wrap gap-4 mt-3">
          {Object.entries(recommendations.budget_allocation).map(
            ([channel, percentage], index) => {
              const colors = ['var(--nts-accent)', '#78716C', '#22C55E', '#8B5CF6', '#F59E0B'];
              return (
                <div key={channel} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: colors[index % colors.length] }}
                  />
                  <span className="text-xs text-[#4A4A4A]">
                    {formatBudgetChannelLabel(channel)}: {percentage}%
                  </span>
                </div>
              );
            }
          )}
        </div>
      </div>

      {/* Channel Mix */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Primary Channels */}
        <div>
          <h5 className="text-sm font-medium text-[#1A1A1A] mb-3 flex items-center gap-2">
            <Zap size={16} className="text-[var(--nts-accent)]" />
            Κύρια κανάλια
          </h5>
          <div className="space-y-2">
            {recommendations.primary.map((channel, index) => {
              const stage = getFunnelStage(channel);
              const pct = getBudgetForChannel(channel, recommendations.budget_allocation);
              return (
                <motion.div
                  key={channel}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center justify-between p-3 bg-[var(--nts-light-gray)] rounded-lg border border-[var(--borderColor-default,#d0d7de)]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-[var(--nts-accent)] rounded-lg flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-sm">{index + 1}</span>
                    </div>
                    <div className="min-w-0">
                      <span className="font-medium text-[#1A1A1A] text-sm">{channel}</span>
                      <span
                        className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: `${stage.color}15`, color: stage.color }}
                      >
                        {stage.label}
                      </span>
                    </div>
                  </div>
                  {pct != null && <Badge variant="orange">{pct}%</Badge>}
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Secondary Channels */}
        <div>
          <h5 className="text-sm font-medium text-[#1A1A1A] mb-3 flex items-center gap-2">
            <Target size={16} className="text-[#4A4A4A]" />
            Δευτερεύοντα κανάλια
          </h5>
          <div className="space-y-2">
            {recommendations.secondary.map((channel, index) => {
              const stage = getFunnelStage(channel);
              const pct = getBudgetForChannel(channel, recommendations.budget_allocation);
              return (
                <motion.div
                  key={channel}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                  className="flex items-center justify-between p-3 bg-[#F5F5F5] rounded-lg"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-[#4A4A4A] rounded-lg flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-sm">
                        {recommendations.primary.length + index + 1}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="text-[#1A1A1A] text-sm">{channel}</span>
                      <span
                        className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: `${stage.color}15`, color: stage.color }}
                      >
                        {stage.label}
                      </span>
                    </div>
                  </div>
                  {pct != null && <Badge variant="default">{pct}%</Badge>}
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Κανάλια που υπάρχουν στο budget_allocation αλλά όχι στα primary/secondary (π.χ. Google Search Ads) */}
      {orphanBudgetChannels.length > 0 && (
        <div className="rounded-xl border border-[#E8E8ED] bg-[#FAFBFC] p-4">
          <h5 className="text-sm font-medium text-[#1A1A1A] mb-2">
            Κανάλια στο budget mix
          </h5>
          <p className="text-xs text-[#6B7280] mb-3">
            Εμφανίζονται όσα έχουν ποσοστό στο budget αλλά δεν συμπεριλήφθηκαν στις λίστες κύριων/δευτερευόντων.
          </p>
          <div className="space-y-2">
            {orphanBudgetChannels.map(([allocKey, pct], index) => {
              const label = formatBudgetChannelLabel(allocKey);
              const stage = getFunnelStage(label);
              return (
                <motion.div
                  key={allocKey}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center justify-between p-3 bg-white rounded-lg border border-[#E5E5E5]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-[#64748B] rounded-lg flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs font-mono">%</span>
                    </div>
                    <div className="min-w-0">
                      <span className="font-medium text-[#1A1A1A] text-sm">{label}</span>
                      <span
                        className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: `${stage.color}15`, color: stage.color }}
                      >
                        {stage.label}
                      </span>
                    </div>
                  </div>
                  <Badge variant="orange">{pct}%</Badge>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rationale */}
      <div className="p-4 bg-gradient-to-r from-[#F5F5F5] to-white rounded-lg border border-[#E5E5E5]">
        <h5 className="font-medium text-[#1A1A1A] text-sm mb-3">Αιτιολόγηση AI</h5>
        {(() => {
          const parts = recommendations.rationale.split('||').map(s => s.trim());
          const hasStructure = parts.length >= 3 && parts[0].startsWith('Πελάτες:');
          if (!hasStructure) {
            return (
              <FormattedProse content={recommendations.rationale.replace(/—/g, ',')} variant="compact" />
            );
          }
          const sections = [
            { icon: Users, color: '#8B5CF6', label: 'Πελάτες' },
            { icon: MessageSquare, color: '#3B82F6', label: 'Κανάλια' },
            { icon: TrendingUp, color: '#22C55E', label: 'Αποτέλεσμα' },
          ];
          return (
            <div className="space-y-2.5">
              {parts.slice(0, 3).map((part, i) => {
                const s = sections[i];
                const text = part.replace(/^(Πελάτες|Κανάλια|Αποτέλεσμα):\s*/i, '');
                const Icon = s.icon;
                const cleaned = text.replace(/—/g, ',');
                return (
                  <div key={i} className="flex items-start gap-2.5">
                    <div
                      className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: `${s.color}15` }}
                    >
                      <Icon size={13} style={{ color: s.color }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-semibold" style={{ color: s.color }}>{s.label}</span>
                      <FormattedProse content={cleaned} variant="compact" />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
