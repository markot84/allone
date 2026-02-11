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
  ExternalLink,
  CheckCircle,
  ArrowRight,
  Check
} from 'lucide-react';
import { Card, CardHeader, Badge, Button } from '../common';
import { useSegments, useContent } from '../../hooks';
import type { ContentItem } from '../../hooks/useContent';
import { 
  activeStrategyContext, 
  strategyContentMap, 
  contentApprovalFlow,
  editorialActions 
} from '../../data/mockContent';
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
  const [showStrategyMap, setShowStrategyMap] = useState(false);
  const [filterAligned, setFilterAligned] = useState<'all' | 'aligned' | 'misaligned'>('all');

  const currentStrategyContent = strategyContentMap[activeStrategyContext.id as keyof typeof strategyContentMap];
  
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
              {currentStrategyContent?.icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-[#1A1A1A]">
                  Active Strategy: {activeStrategyContext.name}
                </h3>
                <Badge variant="success">Active</Badge>
              </div>
              <p className="text-sm text-[#4A4A4A]">
                Approved by {activeStrategyContext.approved_by} on {activeStrategyContext.approved_date}
              </p>
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

        {/* Content Direction */}
        <div className="mt-6 p-4 bg-[#F5F5F5] rounded-xl">
          <h4 className="font-medium text-[#1A1A1A] mb-3 flex items-center gap-2">
            <Sparkles size={16} className="text-[#FF6B35]" />
            AI Content Direction
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <DirectionItem 
              label="Tone" 
              value={activeStrategyContext.content_direction.tone} 
            />
            <DirectionItem 
              label="Focus" 
              value={activeStrategyContext.content_direction.messaging_focus} 
            />
            <DirectionItem 
              label="Products" 
              value={activeStrategyContext.content_direction.product_emphasis} 
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="text-xs text-[#4A4A4A]">Recommended formats:</span>
            {activeStrategyContext.content_direction.recommended_formats.map(format => (
              <Badge key={format} variant="success" size="sm">{format}</Badge>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="text-xs text-[#4A4A4A]">Avoid:</span>
            {activeStrategyContext.content_direction.avoid.map(item => (
              <Badge key={item} variant="danger" size="sm">{item}</Badge>
            ))}
          </div>
        </div>
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
                    {misalignedCount} content items may not align with current {activeStrategyContext.name} strategy
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
                    Close
                  </Button>
                }
              />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.values(strategyContentMap).map((strategy) => {
                  const isActive = strategy.id === activeStrategyContext.id;
                  return (
                    <div
                      key={strategy.id}
                      className={`p-4 rounded-xl border-2 transition-all ${
                        isActive 
                          ? 'border-[#FF6B35] bg-[#FFF0EB]' 
                          : 'border-[#E5E5E5] bg-white hover:border-[#FF6B35]/50'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-2xl">{strategy.icon}</span>
                        <div>
                          <h4 className="font-medium text-[#1A1A1A] text-sm">{strategy.name}</h4>
                          {isActive && <Badge variant="orange" size="sm">Active</Badge>}
                        </div>
                      </div>
                      <div className="space-y-2 text-xs">
                        <div>
                          <span className="text-[#9CA3AF]">Tone:</span>
                          <p className="text-[#4A4A4A]">{strategy.content_tone}</p>
                        </div>
                        <div>
                          <span className="text-[#9CA3AF]">CTA Style:</span>
                          <p className="text-[#4A4A4A]">{strategy.cta_style}</p>
                        </div>
                        <div className="pt-2">
                          <span className="text-[#9CA3AF]">Sample headlines:</span>
                          {strategy.sample_headlines.slice(0, 2).map((h, i) => (
                            <p key={i} className="text-[#4A4A4A] italic">"{h}"</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editorial App Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {editorialActions.map((action) => (
          <Card key={action.id} padding="md" hover>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-[#FFF0EB] rounded-lg flex items-center justify-center text-xl">
                {action.icon}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-[#1A1A1A] text-sm">{action.label}</h4>
                  {action.badge && (
                    <Badge variant="orange" size="sm">{action.badge}</Badge>
                  )}
                </div>
                <p className="text-xs text-[#4A4A4A] mt-1">{action.description}</p>
                <button className="text-xs text-[#FF6B35] mt-2 hover:underline flex items-center gap-1">
                  Open <ExternalLink size={10} />
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

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
                    <p className="text-sm text-[#9CA3AF]">No content scheduled</p>
                    <Button variant="ghost" size="sm" icon={<Plus size={14} />} className="mt-2">
                      Add Content
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
        <div className="flex items-center justify-between overflow-x-auto pb-4">
          {contentApprovalFlow.map((stage, index) => (
            <div key={stage.stage} className="flex items-center">
              <div className="flex flex-col items-center min-w-[120px]">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl ${
                  index < 3 ? 'bg-[#DCFCE7]' : 'bg-[#F5F5F5]'
                }`}>
                  {stage.icon}
                </div>
                <p className="text-xs font-medium text-[#1A1A1A] mt-2 text-center">{stage.label}</p>
                <p className="text-[10px] text-[#4A4A4A] text-center">{stage.approver}</p>
                {stage.auto_flags && (
                  <Badge variant="info" size="sm" className="mt-1">Auto-flags</Badge>
                )}
              </div>
              {index < contentApprovalFlow.length - 1 && (
                <div className={`w-12 h-0.5 ${index < 2 ? 'bg-[#22C55E]' : 'bg-[#E5E5E5]'}`} />
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// Helper Components
function DirectionItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[#9CA3AF] mb-1">{label}</p>
      <p className="text-sm text-[#1A1A1A]">{value}</p>
    </div>
  );
}

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
              Edit
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
