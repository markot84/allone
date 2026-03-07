import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  ArrowRight,
  Zap,
  Trash2
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';
import { Card, CardHeader, Badge, Button, Spinner, Tooltip as InfoTooltip, useToast } from '../common';
import { useSegments, useBrand } from '../../hooks';
import { FirestoreService } from '../../services/firestore';
import { segmentCategoryMatrix } from '../../data';
import type { RFMSegment } from '../../types';

import { formatCurrency, formatNumber, formatPercent } from '../../utils/format';
const fmt = (n: number) => formatCurrency(n, 2);

// Get default RFM score from segment name (fallback when rfm_score is missing)
function getDefaultRFMScoreFromName(segmentName: string): string | null {
  const name = segmentName.toLowerCase().trim();
  const defaults: Record<string, string> = {
    'champions': '5-5-5',
    'loyal_customers': '4-4-3',
    'loyal': '4-4-3',
    'promising': '4-2-3',
    'potential_loyalists': '4-2-3',
    'potential': '4-2-3',
    'at_risk': '2-3-3',
    'hibernating': '2-2-2',
    'lost': '1-1-1',
    'new_customers': '5-1-1',
    'recent_customers': '5-2-2',
    'cant_lose_them': '3-5-5',
    "can't_lose_them": '3-5-5',
    'customers_needing_attention': '3-3-2',
  };
  
  // Try exact match first
  if (defaults[name]) return defaults[name];
  
  // Try partial match
  for (const [key, value] of Object.entries(defaults)) {
    if (name.includes(key) || key.includes(name)) {
      return value;
    }
  }
  
  return null;
}

// Calculate average RFM score from a segment's rfm_score string
// Handles formats like "5-5-5 to 4-4-4" (range) or "555" (3 digits) or "5-5-5"
function calculateAvgRFMScore(rfmScore: string | undefined | null, segmentName?: string): number | null {
  let scoreStr = rfmScore;
  
  // If rfm_score is empty, try to get default from segment name
  if ((!scoreStr || !scoreStr.trim()) && segmentName) {
    scoreStr = getDefaultRFMScoreFromName(segmentName);
  }
  
  if (!scoreStr || typeof scoreStr !== 'string') return null;
  
  const trimmed = scoreStr.trim();
  if (!trimmed) return null;
  
  // Extract all digits from the string
  const digits = trimmed.match(/\d/g);
  if (!digits || digits.length === 0) return null;
  
  // Convert to numbers and filter valid RFM scores (1-5)
  const numbers = digits.map(d => parseInt(d, 10)).filter(n => !isNaN(n) && n >= 1 && n <= 5);
  if (numbers.length === 0) return null;
  
  const sum = numbers.reduce((a, b) => a + b, 0);
  return sum / numbers.length;
}

interface RFMAnalysisProps {
  onSectionChange?: (section: string) => void;
}

export function RFMAnalysis({ onSectionChange }: RFMAnalysisProps = {}) {
  const [selectedSegment, setSelectedSegment] = useState<RFMSegment | null>(null);
  const { segments: rfmSegments, totalCustomers, isLoading: segmentsLoading, hasImported: hasImportedSegments } = useSegments();
  const { currentBrand } = useBrand();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [isDeleting, setIsDeleting] = useState(false);
  const totalCustomersDisplay = totalCustomers;

  const handleDeleteSegments = async () => {
    if (!currentBrand?.id) return;
    if (!window.confirm(`Διαγραφή όλων των segments (${rfmSegments.length}) για το brand "${currentBrand.name}"; Αυτή η ενέργεια δεν αναιρείται.`)) return;
    setIsDeleting(true);
    try {
      await FirestoreService.deleteCollection('segments', currentBrand.id);
      queryClient.invalidateQueries({ queryKey: ['segments', currentBrand.id] });
      queryClient.invalidateQueries({ queryKey: ['segments'] });
      toast.success('Τα segments διαγράφηκαν επιτυχώς.');
    } catch (e) {
      toast.error(`Σφάλμα διαγραφής: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  if (segmentsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Spinner size="lg" label="Φόρτωση data analysis segments…" />
      </div>
    );
  }

  if (!hasImportedSegments) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">Data Analysis</h2>
          <p className="text-[#4A4A4A] mt-1">
            Analyze customer segments through RFM, behavioral and firmographic lenses
          </p>
        </div>
        <Card padding="lg" className="text-center py-12">
          <p className="text-[#4A4A4A] mb-4">
            Δεν υπάρχουν imported segments ακόμα.
          </p>
          <p className="text-sm text-[#4A4A4A]">
            Μεταβείτε στο{' '}
            <button
              type="button"
              onClick={() => onSectionChange?.('data-segments')}
              className="font-semibold text-[var(--nts-accent)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-1 rounded"
            >
              Data Import
            </button>
            {' '}για να εισάγετε segment δεδομένα.
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
        <h2 className="text-2xl font-bold text-[#1A1A1A]">Data Analysis</h2>
        <p className="text-[#4A4A4A] mt-1">
          Analyze customer segments through RFM, behavioral and firmographic lenses
          {hasImportedSegments && (
            <span className="ml-2 text-[#22C55E] font-medium">· {rfmSegments.length} segment(s) · {formatNumber(totalCustomersDisplay)} customers</span>
          )}
        </p>
        </div>
        <Button
          variant="secondary"
          icon={<Trash2 size={16} />}
          onClick={handleDeleteSegments}
          disabled={isDeleting || !hasImportedSegments}
          className="text-[#DC2626] hover:bg-[#FEE2E2]"
        >
          {isDeleting ? 'Διαγραφή…' : 'Διαγραφή δεδομένων'}
        </Button>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card padding="md" hover>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[var(--nts-accent-light)] rounded-lg flex items-center justify-center">
              <Users size={20} className="text-[var(--nts-accent)]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]"><InfoTooltip content="Συνολικός αριθμός πελατών σε όλα τα RFM segments.">Σύνολο Πελατών</InfoTooltip></p>
              <p className="text-xl font-bold text-[#1A1A1A] font-mono">
                {formatNumber(totalCustomersDisplay)}
              </p>
            </div>
          </div>
        </Card>
        <Card padding="md" hover>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#DCFCE7] rounded-lg flex items-center justify-center">
              <TrendingUp size={20} className="text-[#22C55E]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]"><InfoTooltip content="Αριθμός RFM segments (ομαδοποιημένοι πελάτες βάσει Recency, Frequency, Monetary).">Ενεργά Segments</InfoTooltip></p>
              <p className="text-xl font-bold text-[#1A1A1A]">
                {rfmSegments.filter(s => s.id !== 'lost').length}
              </p>
            </div>
          </div>
        </Card>
        <Card padding="md" hover>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#DBEAFE] rounded-lg flex items-center justify-center">
              <Zap size={20} className="text-[#3B82F6]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]"><InfoTooltip content="Μέσος όρος RFM score (1–5 ανά R, F, M).">Μέσος Segment Score</InfoTooltip></p>
              <p className="text-xl font-bold text-[#1A1A1A] font-mono">
                {(() => {
                  if (rfmSegments.length === 0) return '0';
                  
                  const scores = rfmSegments
                    .map((s) => calculateAvgRFMScore(s.rfm_score, s.name))
                    .filter((score): score is number => score !== null && !isNaN(score) && isFinite(score));
                  
                  if (scores.length === 0) {
                    // Debug: log segments without valid scores
                    if (import.meta.env.MODE === 'development') {
                      console.debug('No valid RFM scores found. Segments:', rfmSegments.map(s => ({ 
                        name: s.name, 
                        rfm_score: s.rfm_score,
                        rfm_score_type: typeof s.rfm_score 
                      })));
                    }
                    return '0';
                  }
                  
                  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
                  return formatNumber(avg, 1);
                })()}
              </p>
            </div>
          </div>
        </Card>
        <Card padding="md" hover>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#FEF3C7] rounded-lg flex items-center justify-center">
              <TrendingDown size={20} className="text-[#F59E0B]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]"><InfoTooltip content="Ποσοστό πελατών στο segment «At Risk» (μειωμένη δραστηριότητα).">Ποσοστό At Risk</InfoTooltip></p>
              <p className="text-xl font-bold text-[#F59E0B] font-mono">
                {fmt(rfmSegments.find(s => s.id === 'at_risk')?.percentage ?? 0)}%
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Segment Cards + Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Segment Cards */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          {rfmSegments.map((segment, index) => (
            <SegmentCard
              key={segment.id}
              segment={segment}
              index={index}
              isSelected={selectedSegment?.id === segment.id}
              onSelect={() => setSelectedSegment(
                selectedSegment?.id === segment.id ? null : segment
              )}
            />
          ))}
        </div>

        {/* Distribution Chart */}
        <Card padding="lg" className="min-w-[280px]">
          <CardHeader
            title="Revenue Distribution"
            subtitle="Ανά segment"
          />
          <div
            className="w-full overflow-visible shrink-0"
            style={{ width: '100%', height: 256 }}
          >
            <PieChart width={300} height={256} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Pie
                data={rfmSegments}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={3}
                dataKey="revenue_share"
                nameKey="name"
              >
                {rfmSegments.map((segment) => (
                  <Cell
                    key={segment.id}
                    fill={segment.color}
                    stroke={selectedSegment?.id === segment.id ? '#1A1A1A' : 'none'}
                    strokeWidth={2}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #E5E5E5',
                  borderRadius: '8px'
                }}
                formatter={(value: number | undefined) => [`${fmt(value ?? 0)}%`, 'Revenue']}
              />
            </PieChart>
          </div>
          <div className="space-y-2">
            {rfmSegments.map((segment) => (
              <div
                key={segment.id}
                className={`
                  flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all
                  ${selectedSegment?.id === segment.id ? 'bg-[#F5F5F5]' : 'hover:bg-[#F5F5F5]'}
                `}
                onClick={() => setSelectedSegment(
                  selectedSegment?.id === segment.id ? null : segment
                )}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: segment.color }}
                  />
                  <span className="text-sm text-[#4A4A4A]">{segment.name}</span>
                </div>
                <span className="text-sm font-medium font-mono" style={{ color: segment.color }}>
                  {fmt(segment.revenue_share ?? 0)}%
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Segment Detail Panel */}
      <AnimatePresence>
        {selectedSegment && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <SegmentDetail segment={selectedSegment} onClose={() => setSelectedSegment(null)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Migration Flow */}
      <Card padding="lg">
        <CardHeader
          title="Segment Migration"
          subtitle={hasImportedSegments ? 'Τελευταίες 30 ημέρες' : ''}
          icon={<ArrowRight size={20} className="text-[var(--nts-accent)]" />}
        />
        <div className="space-y-3">
          {hasImportedSegments && rfmSegments.length > 0 ? (
            // Show empty migration flows (zeros) when no comparison data exists
            // In the future, this will be populated from actual migration comparison data
            rfmSegments.length > 0 ? (
              <p className="text-sm text-[#4A4A4A] py-4 text-center">
                Δεν υπάρχουν συγκρινόμενα δεδομένα για την περίοδο. Φόρτωσε δεδομένα από διαφορετικές περιόδους για να δεις την μετακίνηση μεταξύ segments.
              </p>
            ) : (
              <p className="text-sm text-[#4A4A4A] py-4">
                Φόρτωσε RFM δεδομένα για να δεις την μετακίνηση μεταξύ segments.
              </p>
            )
          ) : (
            <p className="text-sm text-[#4A4A4A] py-4">
              Φόρτωσε RFM δεδομένα για να δεις την μετακίνηση μεταξύ segments.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

interface SegmentCardProps {
  segment: RFMSegment;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
}

function SegmentCard({ segment, index, isSelected, onSelect }: SegmentCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card
        padding="md"
        hover
        onClick={onSelect}
        className={isSelected ? 'ring-2 ring-[var(--nts-accent)]' : ''}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{
                backgroundColor: `${segment.color}35`,
                border: `2px solid ${segment.color}`,
              }}
            >
              {/* segment color indicator */}
            </div>
            <div>
              <h3 className="font-semibold text-[#1A1A1A]">{segment.name}</h3>
              <p className="text-xs text-[#4A4A4A]">{segment.rfm_score}</p>
            </div>
          </div>
          <ChevronRight
            size={18}
            className={`text-[#9CA3AF] transition-transform ${isSelected ? 'rotate-90' : ''}`}
          />
        </div>

        <p className="text-sm text-[#4A4A4A] mt-3">{segment.description}</p>

        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-[#E5E5E5]">
          <div>
            <p className="text-xs text-[#4A4A4A]">Customers</p>
            <p className="font-bold text-[#1A1A1A] font-mono">
              {formatNumber(segment.count)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#4A4A4A]">% of Base</p>
            <p className="font-bold font-mono" style={{ color: segment.color }}>
              {fmt(segment.percentage ?? 0)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-[#4A4A4A]">Revenue</p>
            <p className="font-bold text-[#1A1A1A] font-mono">
              {fmt(segment.revenue_share ?? 0)}%
            </p>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

interface SegmentDetailProps {
  segment: RFMSegment;
  onClose: () => void;
}

const emptyCategoryData = { categories: [], brands: [], price_sensitivity: 'medium' as const, preferred_channels: [] };

function SegmentDetail({ segment, onClose }: SegmentDetailProps) {
  const { hasImported: hasImportedSegments } = useSegments();
  // Use empty data when no imported segments exist (no mock data)
  const categoryData = hasImportedSegments 
    ? (segmentCategoryMatrix[segment.id] ?? emptyCategoryData)
    : emptyCategoryData;

  return (
    <Card padding="lg">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl"
            style={{ backgroundColor: `${segment.color}20` }}
          >
            {/* no emoji icons */}
          </div>
          <div>
            <h3 className="text-xl font-bold text-[#1A1A1A]">{segment.name}</h3>
            <p className="text-[#4A4A4A]">{segment.description}</p>
          </div>
        </div>
        <Button variant="ghost" onClick={onClose}>Κλείσιμο</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Affinity */}
        <div>
          <h4 className="font-medium text-[#1A1A1A] mb-4">Category Preferences</h4>
          {categoryData?.categories && categoryData.categories.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryData.categories}
                  layout="vertical"
                  margin={{ left: 100 }}
                >
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                <XAxis
                  type="number"
                  domain={[0, 1]}
                  tickFormatter={(v) => formatPercent((v as number) * 100, 0)}
                  tick={{ fill: '#4A4A4A', fontSize: 12 }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: '#4A4A4A', fontSize: 12 }}
                  width={95}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #E5E5E5',
                    borderRadius: '8px'
                  }}
                  formatter={(value) => [formatPercent(((value as number) || 0) * 100, 0), 'Affinity']}
                />
                  <Bar dataKey="affinity" fill={segment.color} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center bg-[#F5F5F5] rounded-lg">
              <p className="text-sm text-[#4A4A4A]">Δεν υπάρχουν δεδομένα category preferences</p>
            </div>
          )}
        </div>

        {/* Segment Details */}
        <div className="space-y-4">
          <div className="p-4 bg-[#F5F5F5] rounded-lg">
            <h5 className="text-sm font-medium text-[#1A1A1A] mb-2">Preferred Brands</h5>
            <div className="flex flex-wrap gap-2">
              {categoryData?.brands && categoryData.brands.length > 0 ? (
                categoryData.brands.map((brand) => (
                  <Badge key={brand} variant="default">{brand}</Badge>
                ))
              ) : (
                <p className="text-xs text-[#4A4A4A]">Δεν υπάρχουν δεδομένα</p>
              )}
            </div>
          </div>

          <div className="p-4 bg-[#F5F5F5] rounded-lg">
            <h5 className="text-sm font-medium text-[#1A1A1A] mb-2">Price Sensitivity</h5>
            <Badge
              variant={
                categoryData?.price_sensitivity === 'low' ? 'success' :
                categoryData?.price_sensitivity === 'medium' ? 'warning' : 'danger'
              }
              size="md"
            >
              {categoryData?.price_sensitivity?.toUpperCase()}
            </Badge>
          </div>

          <div className="p-4 bg-[#F5F5F5] rounded-lg">
            <h5 className="text-sm font-medium text-[#1A1A1A] mb-2">Preferred Channels</h5>
            <div className="flex flex-wrap gap-2">
              {categoryData?.preferred_channels && categoryData.preferred_channels.length > 0 ? (
                categoryData.preferred_channels.map((channel) => (
                  <Badge key={channel} variant="info">{channel}</Badge>
                ))
              ) : (
                <p className="text-xs text-[#4A4A4A]">Δεν υπάρχουν δεδομένα</p>
              )}
            </div>
          </div>

          <Button variant="primary" className="w-full" icon={<Zap size={16} />}>
            Create Campaign for {segment.name}
          </Button>
        </div>
      </div>
    </Card>
  );
}
