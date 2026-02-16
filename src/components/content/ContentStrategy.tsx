import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Eye,
  Edit,
  Sparkles,
  Clock,
  AlertTriangle,
  Pause,
  Link2,
  FileText,
  CheckCircle,
  ArrowRight,
  Check
} from 'lucide-react';
import { Card, CardHeader, Badge, Button } from '../common';
import { useSegments, useContent } from '../../hooks';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import type { ContentItem } from '../../hooks/useContent';
// Removed mock content imports - using only real data from useContent hook
const statusConfig = {
  draft: { label: 'Draft', color: '#4A4A4A', bgColor: '#F5F5F5', icon: <FileText size={12} /> },
  in_production: { label: 'In Production', color: '#3B82F6', bgColor: '#DBEAFE', icon: <Edit size={12} /> },
  approved: { label: 'Approved', color: '#8B5CF6', bgColor: '#EDE9FE', icon: <Check size={12} /> },
  scheduled: { label: 'Scheduled', color: '#22C55E', bgColor: '#DCFCE7', icon: <Clock size={12} /> },
  published: { label: 'Published', color: '#22C55E', bgColor: '#DCFCE7', icon: <CheckCircle size={12} /> },
  on_hold: { label: 'On Hold', color: '#F59E0B', bgColor: '#FEF3C7', icon: <Pause size={12} /> }
};

export function ContentStrategy() {
  const { segments: rfmSegments } = useSegments();
  const { contentItems } = useContent();
  const { activeStrategy, getStrategyName, isLoading: strategyLoading } = useActiveStrategy();
  const [showStrategyMap, setShowStrategyMap] = useState(false);
  const [filterAligned, setFilterAligned] = useState<'all' | 'aligned' | 'misaligned'>('all');

  // Removed mock data - using only real contentItems from useContent hook
  
  const filteredContent = contentItems.filter(item => {
    if (filterAligned === 'all') return true;
    if (filterAligned === 'aligned') return item.is_aligned;
    return !item.is_aligned;
  });

  const alignedCount = contentItems.filter(c => c.is_aligned).length;
  const misalignedCount = contentItems.filter(c => !c.is_aligned).length;

  // Group content by week
  const contentByWeek = filteredContent.reduce((acc, item) => {
    const week = item.week ?? 0;
    if (!acc[week]) acc[week] = [];
    acc[week].push(item);
    return acc;
  }, {} as Record<number, ContentItem[]>);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">Content Strategy</h2>
          <p className="text-[#4A4A4A] mt-1">
            Align your content with commercial strategy
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            icon={<Link2 size={16} />}
            onClick={() => setShowStrategyMap(!showStrategyMap)}
          >
            Strategy Map
          </Button>
          <Button variant="primary" icon={<Plus size={16} />}>
            New Content
          </Button>
        </div>
      </div>

      {/* Strategy-Content Alignment Panel */}
      <Card padding="lg" className="border-l-4 border-l-[#FF6B35]">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-[#FFF0EB] rounded-xl flex items-center justify-center text-3xl">
              <Sparkles size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-[#1A1A1A]">
                  {strategyLoading 
                    ? 'Φόρτωση στρατηγικής...'
                    : activeStrategy 
                    ? `${getStrategyName(activeStrategy.scenarioId)}`
                    : 'Δεν υπάρχει ενεργή στρατηγική'}
                </h3>
                {activeStrategy && activeStrategy.approvalStatus === 'implementing' && (
                  <Badge variant="success">Ενεργή</Badge>
                )}
                {activeStrategy && activeStrategy.approvalStatus === 'approved' && (
                  <Badge variant="default">Εγκεκριμένη</Badge>
                )}
                {activeStrategy && activeStrategy.approvalStatus === 'draft' && (
                  <Badge variant="default">Προσχέδιο</Badge>
                )}
                {activeStrategy && activeStrategy.approvalStatus === 'pending_review' && (
                  <Badge variant="default">Σε Αναμονή</Badge>
                )}
              </div>
              <p className="text-sm text-[#4A4A4A]">
                {strategyLoading 
                  ? 'Ελέγχοντας για ενεργή στρατηγική...'
                  : activeStrategy 
                  ? `${contentItems.length > 0 ? `${contentItems.length} content items, ` : ''}${alignedCount} aligned, ${misalignedCount} need review`
                  : 'Πήγαινε στο Strategy Weights για να ορίσεις ενεργή στρατηγική'}
              </p>
              {activeStrategy && 'implementedAt' in activeStrategy && activeStrategy.implementedAt && (
                <p className="text-xs text-[#9CA3AF] mt-1">
                  Εφαρμογή: {new Date(activeStrategy.implementedAt).toLocaleDateString('el-GR')}
                </p>
              )}
              {activeStrategy && 'approvedBy' in activeStrategy && activeStrategy.approvedBy && (
                <p className="text-xs text-[#9CA3AF] mt-1">
                  Εγκεκρίθηκε από: {activeStrategy.approvedBy}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-[#22C55E] font-mono">{alignedCount}</p>
              <p className="text-xs text-[#4A4A4A]">Aligned</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-[#F59E0B] font-mono">{misalignedCount}</p>
              <p className="text-xs text-[#4A4A4A]">Need Review</p>
            </div>
          </div>
        </div>

        {/* Strategy Details - Show when active strategy exists */}
        {activeStrategy && (
          <div className="mt-6 p-4 bg-[#F5F5F5] rounded-xl">
            <h4 className="font-medium text-[#1A1A1A] mb-3 flex items-center gap-2">
              <Sparkles size={16} className="text-[#FF6B35]" />
              Στρατηγική: {getStrategyName(activeStrategy.scenarioId)}
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <div>
                <p className="text-xs text-[#9CA3AF]">Profit</p>
                <p className="font-semibold text-[#1A1A1A]">{activeStrategy.weights?.profit || 0}%</p>
              </div>
              <div>
                <p className="text-xs text-[#9CA3AF]">Stock</p>
                <p className="font-semibold text-[#1A1A1A]">{activeStrategy.weights?.stock || 0}%</p>
              </div>
              <div>
                <p className="text-xs text-[#9CA3AF]">Strategic</p>
                <p className="font-semibold text-[#1A1A1A]">{activeStrategy.weights?.strategic || 0}%</p>
              </div>
              <div>
                <p className="text-xs text-[#9CA3AF]">Revenue</p>
                <p className="font-semibold text-[#1A1A1A]">{activeStrategy.weights?.revenue || 0}%</p>
              </div>
              <div>
                <p className="text-xs text-[#9CA3AF]">Fit</p>
                <p className="font-semibold text-[#1A1A1A]">{activeStrategy.weights?.fit || 0}%</p>
              </div>
            </div>
          </div>
        )}

        {/* Content Direction - Only show when we have content items */}
        {contentItems.length > 0 && (
          <div className="mt-6 p-4 bg-[#F5F5F5] rounded-xl">
            <h4 className="font-medium text-[#1A1A1A] mb-3 flex items-center gap-2">
              <Sparkles size={16} className="text-[#FF6B35]" />
              Content Overview
            </h4>
            <p className="text-sm text-[#4A4A4A]">
              {contentItems.length} content items imported. {alignedCount} aligned with strategy, {misalignedCount} need review.
            </p>
          </div>
        )}
      </Card>

      {/* Misalignment Alert */}
      {misalignedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card padding="md" className="bg-[#FEF3C7] border-[#F59E0B]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertTriangle size={20} className="text-[#F59E0B]" />
                <div>
                  <p className="font-medium text-[#92400E]">
                    {misalignedCount} content items ενδέχεται να μην ευθυγραμμίζονται με την τρέχουσα στρατηγική
                  </p>
                  <p className="text-sm text-[#B45309]">
                    Review and reschedule or adjust content to match strategy direction
                  </p>
                </div>
              </div>
              <Button 
                variant="secondary" 
                size="sm"
                onClick={() => setFilterAligned('misaligned')}
              >
                Review Content
              </Button>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Strategy-to-Content Map (Collapsible) */}
      <AnimatePresence>
        {showStrategyMap && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <Card padding="lg">
              <CardHeader
                title="Strategy-to-Content Mapping"
                subtitle="How each strategy influences content"
                icon={<Link2 size={20} className="text-[#FF6B35]" />}
                action={
                  <Button variant="ghost" size="sm" onClick={() => setShowStrategyMap(false)}>
                    Κλείσιμο
                  </Button>
                }
              />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <p className="text-sm text-[#4A4A4A]">
                  Strategy mapping will be available when content items are imported.
                </p>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editorial App Actions - Removed mock data */}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-[#E5E5E5] pb-4">
        {[
          { key: 'all', label: 'All Content', count: contentItems.length },
          { key: 'aligned', label: 'Aligned', count: alignedCount },
          { key: 'misaligned', label: 'Needs Review', count: misalignedCount }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilterAligned(tab.key as any)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filterAligned === tab.key
                ? 'bg-[#FF6B35] text-white'
                : 'bg-[#F5F5F5] text-[#4A4A4A] hover:bg-[#E5E5E5]'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Content Calendar Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((week) => {
          const weekContent = contentByWeek[week] || [];
          const weekAligned = weekContent.filter(c => c.is_aligned).length;
          const weekTotal = weekContent.length;

          return (
            <div key={week}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-[#1A1A1A]">Week {week}</h3>
                {weekTotal > 0 && (
                  <span className={`text-xs font-medium ${
                    weekAligned === weekTotal ? 'text-[#22C55E]' : 'text-[#F59E0B]'
                  }`}>
                    {weekAligned}/{weekTotal} aligned
                  </span>
                )}
              </div>
              <div className="space-y-3">
                {weekContent.length === 0 ? (
                  <div className="p-4 border-2 border-dashed border-[#E5E5E5] rounded-xl text-center">
                    <p className="text-sm text-[#9CA3AF]">Δεν υπάρχει προγραμματισμένο περιεχόμενο</p>
                    <Button variant="ghost" size="sm" icon={<Plus size={14} />} className="mt-2">
                      Προσθήκη Περιεχομένου
                    </Button>
                  </div>
                ) : (
                  weekContent.map((item, index) => (
                    <ContentCard key={item.id} item={item} index={index} segments={rfmSegments} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Content Approval Workflow */}
      <Card padding="lg">
        <CardHeader
          title="Content Approval Workflow"
          subtitle="Stages from brief to publication"
          icon={<ArrowRight size={20} className="text-[#FF6B35]" />}
        />
        <div className="text-center py-8">
          <p className="text-sm text-[#4A4A4A]">
            Content approval workflow will be available when content items are imported.
          </p>
        </div>
      </Card>
    </div>
  );
}

// Removed DirectionItem helper - not used anymore

interface ContentCardProps {
  item: ContentItem;
  index: number;
  segments?: Array<{ id: string; name?: string; color?: string }>;
}

function ContentCard({ item, index, segments = [] }: ContentCardProps) {
  const status = statusConfig[item.status as keyof typeof statusConfig] ?? statusConfig.draft;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card
        padding="sm"
        hover
        className={`border-l-4 ${
          item.is_aligned ? 'border-l-[#22C55E]' : 'border-l-[#F59E0B]'
        }`}
      >
        <div className="p-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              {item.is_aligned ? (
                <CheckCircle size={14} className="text-[#22C55E]" />
              ) : (
                <AlertTriangle size={14} className="text-[#F59E0B]" />
              )}
              <Badge variant="default" size="sm">{item.type}</Badge>
            </div>
            <div
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]"
              style={{ backgroundColor: status.bgColor, color: status.color }}
            >
              {status.icon}
              {status.label}
            </div>
          </div>

          {/* Title */}
          <h4 className="font-medium text-[#1A1A1A] text-sm mt-2 line-clamp-2">
            {item.title}
          </h4>

          {/* Meta */}
          <div className="flex items-center gap-2 mt-2 text-xs text-[#4A4A4A]">
            <span>{item.scheduled}</span>
            <span>•</span>
            <span className="flex items-center gap-1">
              {(() => {
                const seg = segments.find(s => s.name === item.segment || s.id === item.segment);
                return seg ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color ?? '#6B7280' }} />
                    {item.segment}
                  </>
                ) : item.segment;
              })()}
            </span>
          </div>

          {/* Products */}
          {(() => {
            const pf = item.products_featured;
            const count = typeof pf === 'number' ? pf : pf?.length ?? 0;
            return count > 0 ? (
              <p className="text-xs text-[#9CA3AF] mt-1">
                {count} products
              </p>
            ) : null;
          })()}

          {/* Alignment Warning */}
          {!item.is_aligned && item.alignment_warning && (
            <div className="mt-2 p-2 bg-[#FEF3C7] rounded text-xs text-[#92400E]">
              ⚠️ {item.alignment_warning}
            </div>
          )}

          {/* Performance (if published) */}
          {item.performance && (
            <div className="mt-2 pt-2 border-t border-[#E5E5E5] grid grid-cols-3 gap-1 text-center">
              <div>
                <p className="text-[10px] text-[#9CA3AF]">Opens</p>
                <p className="text-xs font-bold font-mono">{(item.performance.opens ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] text-[#9CA3AF]">Clicks</p>
                <p className="text-xs font-bold font-mono">{item.performance.clicks}</p>
              </div>
              <div>
                <p className="text-[10px] text-[#9CA3AF]">Conv.</p>
                <p className="text-xs font-bold font-mono text-[#22C55E]">{item.performance.conversions}</p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 mt-3">
            <Button variant="ghost" size="sm" icon={<Eye size={12} />} className="flex-1 text-xs">
              View
            </Button>
            <Button variant="ghost" size="sm" icon={<Edit size={12} />} className="flex-1 text-xs">
              Επεξεργασία
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
