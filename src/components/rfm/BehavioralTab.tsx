import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Smartphone,
  Monitor,
  ShoppingBag,
  Mail,
  Clock,
  TrendingUp,
  Heart,
  Users,
  ArrowUpRight,
} from 'lucide-react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { Card, CardHeader, Badge, Tooltip } from '../common';
import { deriveBehavioralProfile } from '../../services/behavioralEngine';
import { formatNumber } from '../../utils/format';
import type { RFMSegment } from '../../types';

interface BehavioralTabProps {
  segments: RFMSegment[];
}

const LIFECYCLE_LABELS: Record<string, string> = {
  new: 'Νέος',
  active: 'Ενεργός',
  loyal: 'Πιστός',
  declining: 'Φθίνων',
  dormant: 'Αδρανής',
};

const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'Καθημερινά',
  weekly: 'Εβδομαδιαία',
  monthly: 'Μηνιαία',
  quarterly: 'Τριμηνιαία',
  rare: 'Σπάνια',
};

const LIFECYCLE_COLORS: Record<string, string> = {
  new: '#3B82F6',
  active: '#22C55E',
  loyal: '#16A34A',
  declining: '#F59E0B',
  dormant: '#EF4444',
};

export function BehavioralTab({ segments }: BehavioralTabProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  const enriched = useMemo(() =>
    segments.map(seg => ({
      segment: seg,
      profile: deriveBehavioralProfile(seg),
      isImported: !!seg.behavioral,
    })),
  [segments]);

  const hasImportedData = enriched.some(e => e.isImported);

  const selected = enriched[selectedIdx];
  if (!selected) return null;
  const { segment, profile } = selected;

  const radarData = [
    { metric: 'Engagement', value: profile.engagement_score },
    { metric: 'Upsell', value: profile.upsell_score },
    { metric: 'Cross-sell', value: profile.cross_sell_score },
    { metric: 'Loyalty', value: profile.lifecycle_stage === 'loyal' ? 90 : profile.lifecycle_stage === 'active' ? 65 : profile.lifecycle_stage === 'new' ? 45 : 20 },
    { metric: 'Frequency', value: profile.purchase_frequency === 'daily' ? 95 : profile.purchase_frequency === 'weekly' ? 80 : profile.purchase_frequency === 'monthly' ? 55 : profile.purchase_frequency === 'quarterly' ? 30 : 10 },
  ];

  const channelData = profile.preferred_channels.map((ch, i) => ({
    channel: ch,
    score: Math.max(20, 95 - i * 18),
  }));

  return (
    <div className="space-y-6">
      {/* Data Source Indicator */}
      <div className="flex items-center gap-2 text-xs">
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${hasImportedData ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FEF3C7] text-[#D97706]'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${hasImportedData ? 'bg-[#22C55E]' : 'bg-[#F59E0B]'}`} />
          {hasImportedData ? 'Imported data' : 'Derived from RFM (εισάγετε data για ακρίβεια)'}
        </span>
      </div>

      {/* Segment Selector */}
      <div className="flex gap-2 flex-wrap">
        {enriched.map((item, i) => (
          <button
            key={item.segment.id}
            onClick={() => setSelectedIdx(i)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              i === selectedIdx
                ? 'text-white shadow-sm'
                : 'bg-[var(--nts-light-gray)] text-[var(--text-secondary)] hover:bg-[var(--border)]'
            }`}
            style={i === selectedIdx ? { backgroundColor: item.segment.color } : undefined}
          >
            {item.segment.name}
          </button>
        ))}
      </div>

      {/* Profile Header */}
      <motion.div
        key={segment.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-1 md:grid-cols-4 gap-4"
      >
        <Card padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${segment.color}20` }}>
              <Users size={20} style={{ color: segment.color }} />
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">Persona</p>
              <p className="text-sm font-bold text-[var(--text-primary)]">{profile.persona}</p>
            </div>
          </div>
        </Card>
        <Card padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#F0FDF4] flex items-center justify-center">
              <Heart size={20} className="text-[#22C55E]" />
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">
                <Tooltip content="Στάδιο στον κύκλο ζωής του πελάτη" size={12}>Lifecycle</Tooltip>
              </p>
              <p className="text-sm font-bold" style={{ color: LIFECYCLE_COLORS[profile.lifecycle_stage] || 'var(--text-secondary)' }}>
                {LIFECYCLE_LABELS[profile.lifecycle_stage] || profile.lifecycle_stage}
              </p>
            </div>
          </div>
        </Card>
        <Card padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#EFF6FF] flex items-center justify-center">
              <ShoppingBag size={20} className="text-[#3B82F6]" />
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">
                <Tooltip content="Μέση αξία καλαθιού ανά αγορά" size={12}>Μέσο Καλάθι</Tooltip>
              </p>
              <p className="text-sm font-bold font-mono text-[var(--text-primary)]">€{formatNumber(profile.avg_basket_size)}</p>
            </div>
          </div>
        </Card>
        <Card padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#FEF3C7] flex items-center justify-center">
              <Clock size={20} className="text-[#F59E0B]" />
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">
                <Tooltip content="Πόσο συχνά αγοράζει αυτό το segment" size={12}>Συχνότητα</Tooltip>
              </p>
              <p className="text-sm font-bold text-[var(--text-primary)]">{FREQUENCY_LABELS[profile.purchase_frequency] || profile.purchase_frequency}</p>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Radar Chart */}
        <Card padding="lg" className="lg:col-span-1">
          <CardHeader title="Behavioral Profile" subtitle={segment.name} />
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis
                  dataKey="metric"
                  tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                />
                <PolarRadiusAxis
                  domain={[0, 100]}
                  tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                  axisLine={false}
                />
                <Radar
                  dataKey="value"
                  stroke={segment.color}
                  fill={segment.color}
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Channel Preferences + Scores */}
        <Card padding="lg" className="lg:col-span-1">
          <CardHeader
            title="Προτιμώμενα Κανάλια"
            subtitle="Βαθμολογία ανά κανάλι"
            icon={<Mail size={18} className="text-[var(--nts-accent-text)]" />}
          />
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={channelData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis type="category" dataKey="channel" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={120} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                  formatter={(v: number | undefined) => [`${(v as number) || 0}%`, 'Score']}
                />
                <Bar dataKey="score" fill={segment.color} radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Key Metrics */}
        <Card padding="lg" className="lg:col-span-1">
          <CardHeader
            title="Scores & Opportunities"
            subtitle="Upsell, Cross-sell, Engagement"
            icon={<TrendingUp size={18} className="text-[var(--nts-accent-text)]" />}
          />
          <div className="space-y-4 mt-2">
            <ScoreBar label="Engagement Score" value={profile.engagement_score} color="#3B82F6" tooltip="Βαθμός αλληλεπίδρασης πελάτη (email opens, clicks, visits)" />
            <ScoreBar label="Upsell Score" value={profile.upsell_score} color="#22C55E" tooltip="Πιθανότητα αναβάθμισης σε premium προϊόντα" />
            <ScoreBar label="Cross-sell Score" value={profile.cross_sell_score} color="#8B5CF6" tooltip="Πιθανότητα αγοράς από διαφορετική κατηγορία" />

            <div className="border-t border-[var(--border)] pt-4 mt-4 space-y-3">
              <DetailRow
                icon={<Monitor size={14} />}
                label="Device"
                value={profile.device_preference === 'mobile' ? 'Mobile First' : profile.device_preference === 'desktop' ? 'Desktop First' : 'Mixed'}
              />
              <DetailRow
                icon={<ShoppingBag size={14} />}
                label="Price Sensitivity"
                value={profile.price_sensitivity === 'low' ? 'Χαμηλή' : profile.price_sensitivity === 'medium' ? 'Μεσαία' : 'Υψηλή'}
                badge
                badgeVariant={profile.price_sensitivity === 'low' ? 'success' : profile.price_sensitivity === 'medium' ? 'warning' : 'danger'}
              />
              <DetailRow
                icon={<Clock size={14} />}
                label="Peak Hours"
                value={profile.peak_hours.join(', ') || '—'}
              />
              <DetailRow
                icon={<Smartphone size={14} />}
                label="Payment"
                value={profile.payment_method}
              />
            </div>
          </div>
        </Card>
      </div>

      {/* Communication Recommendations */}
      <Card padding="lg">
        <CardHeader
          title="Συστάσεις Επικοινωνίας"
          subtitle="Βέλτιστο κανάλι, συχνότητα και ώρα ανά persona"
          icon={<ArrowUpRight size={18} className="text-[var(--nts-accent-text)]" />}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          {profile.communication_preferences.map((pref, i) => (
            <motion.div
              key={pref.channel}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] hover:border-[var(--nts-accent)]/30 transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                <Mail size={14} style={{ color: segment.color }} />
                <span className="text-sm font-semibold text-[var(--text-primary)]">{pref.channel}</span>
              </div>
              <div className="space-y-1 text-xs text-[var(--text-secondary)]">
                <p>Συχνότητα: <span className="font-medium text-[var(--text-primary)]">{pref.frequency}</span></p>
                <p>Καλύτερη ώρα: <span className="font-medium text-[var(--text-primary)]">{pref.best_time}</span></p>
              </div>
            </motion.div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ScoreBar({ label, value, color, tooltip }: { label: string; value: number; color: string; tooltip: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-[var(--text-secondary)]">
          <Tooltip content={tooltip} size={12}>{label}</Tooltip>
        </span>
        <span className="text-xs font-bold font-mono" style={{ color }}>{value}%</span>
      </div>
      <div className="w-full h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function DetailRow({ icon, label, value, badge, badgeVariant }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  badge?: boolean;
  badgeVariant?: 'success' | 'warning' | 'danger';
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-[var(--text-secondary)]">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      {badge ? (
        <Badge variant={badgeVariant || 'default'} size="sm">{value}</Badge>
      ) : (
        <span className="text-xs font-medium text-[var(--text-primary)]">{value}</span>
      )}
    </div>
  );
}
