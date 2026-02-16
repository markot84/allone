import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Eye,
  Edit,
  Sparkles,
  Check,
  Clock,
  FileText
} from 'lucide-react';
import { Card, CardHeader, Badge, Button } from '../common';
import { useSegments } from '../../hooks';
import { useContent } from '../../hooks';
// Removed mock calendar imports - using only real data from useContent hook

const statusConfig = {
  draft: { label: 'Προσχέδιο', color: '#4A4A4A', bgColor: '#F5F5F5', icon: <FileText size={12} /> },
  in_production: { label: 'Σε Παραγωγή', color: '#3B82F6', bgColor: '#DBEAFE', icon: <Edit size={12} /> },
  scheduled: { label: 'Προγραμματισμένο', color: '#8B5CF6', bgColor: '#EDE9FE', icon: <Clock size={12} /> },
  published: { label: 'Δημοσιευμένο', color: '#22C55E', bgColor: '#DCFCE7', icon: <Check size={12} /> }
};

export function ContentCalendar() {
  const { segments: rfmSegments } = useSegments();
  const { contentItems } = useContent();
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [showAIPanel, setShowAIPanel] = useState(false);
  
  // Group content items by week
  const contentByWeek = contentItems.reduce((acc, item) => {
    const week = item.week ?? 0;
    if (!acc[week]) acc[week] = [];
    acc[week].push(item);
    return acc;
  }, {} as Record<number, typeof contentItems>);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">Content Calendar</h2>
          <p className="text-[#4A4A4A] mt-1">
            Plan and manage your content strategy across all channels
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            icon={<Sparkles size={16} />}
            onClick={() => setShowAIPanel(!showAIPanel)}
          >
            AI Generator
          </Button>
          <Button variant="primary" icon={<Plus size={16} />}>
            New Content
          </Button>
        </div>
      </div>

      {/* Month Navigation */}
      <Card padding="md">
        <div className="flex items-center justify-between">
          <button className="p-2 rounded-lg hover:bg-[#F5F5F5] transition-colors">
            <ChevronLeft size={20} className="text-[#4A4A4A]" />
          </button>
          <div className="text-center">
            <h3 className="text-xl font-bold text-[#1A1A1A]">
              {contentItems.length > 0 ? `${contentItems.length} Content Items` : 'No Content Items'}
            </h3>
            <p className="text-sm text-[#4A4A4A]">
              {contentItems.length > 0 ? 'Content calendar from imported data' : 'Import content items to see calendar'}
            </p>
          </div>
          <button className="p-2 rounded-lg hover:bg-[#F5F5F5] transition-colors">
            <ChevronRight size={20} className="text-[#4A4A4A]" />
          </button>
        </div>
      </Card>

      {/* Calendar Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {contentItems.length === 0 ? (
          <div className="col-span-4 p-8 text-center border-2 border-dashed border-[#E5E5E5] rounded-xl">
            <p className="text-sm text-[#4A4A4A]">Δεν υπάρχουν content items. Εισαγάγετε content για να δείτε το calendar.</p>
          </div>
        ) : (
          Object.entries(contentByWeek).map(([week, weekItems]) => {
            const weekNum = parseInt(week);
            return weekItems.map((item, itemIndex) => {
              const status = statusConfig[item.status as keyof typeof statusConfig] ?? statusConfig.draft;
              const isSelected = selectedWeek === weekNum;

              return (
                <motion.div
                  key={`${item.id || weekNum}-${itemIndex}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: itemIndex * 0.1 }}
                >
                  <Card
                    padding="md"
                    hover
                    onClick={() => setSelectedWeek(isSelected ? null : weekNum)}
                    className={isSelected ? 'ring-2 ring-[#FF6B35]' : ''}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <Badge variant="orange">Week {weekNum}</Badge>
                      <div
                        className="flex items-center gap-1 px-2 py-1 rounded-full text-xs"
                        style={{ backgroundColor: status.bgColor, color: status.color }}
                      >
                        {status.icon}
                        {status.label}
                      </div>
                    </div>

                    <h4 className="font-semibold text-[#1A1A1A] mb-2">{item.title || item.topic || 'Content Item'}</h4>

                    <div className="space-y-3">
                      {/* Formats */}
                      {item.formats && item.formats.length > 0 && (
                        <div>
                          <p className="text-xs text-[#4A4A4A] mb-1">Formats</p>
                          <div className="flex flex-wrap gap-1">
                            {item.formats.slice(0, 3).map((format) => (
                              <Badge key={format} variant="default" size="sm">
                                {format}
                              </Badge>
                            ))}
                            {item.formats.length > 3 && (
                              <Badge variant="default" size="sm">
                                +{item.formats.length - 3}
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Segments */}
                      {item.target_segments && item.target_segments.length > 0 && (
                        <div>
                          <p className="text-xs text-[#4A4A4A] mb-1">Target Segments</p>
                          <div className="flex flex-wrap gap-1">
                            {item.target_segments.slice(0, 2).map((seg) => {
                              const segment = rfmSegments.find(s => s.name === seg);
                              return (
                                <span
                                  key={seg}
                                  className="text-xs px-2 py-0.5 rounded-full"
                                  style={{
                                    backgroundColor: segment ? `${segment.color ?? '#6B7280'}20` : '#F5F5F5',
                                    color: segment?.color || '#4A4A4A'
                                  }}
                                >
                                  {seg}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Performance (if published) */}
                      {item.performance && (
                        <div className="pt-3 border-t border-[#E5E5E5]">
                          <div className="grid grid-cols-3 gap-2 text-center">
                            {item.performance.opens && (
                              <div>
                                <p className="text-xs text-[#4A4A4A]">Opens</p>
                                <p className="font-bold text-[#1A1A1A] font-mono text-sm">
                                  {item.performance.opens.toLocaleString()}
                                </p>
                              </div>
                            )}
                            {item.performance.clicks && (
                              <div>
                                <p className="text-xs text-[#4A4A4A]">Clicks</p>
                                <p className="font-bold text-[#22C55E] font-mono text-sm">
                                  {item.performance.clicks.toLocaleString()}
                                </p>
                              </div>
                            )}
                            {item.performance.conversions && (
                              <div>
                                <p className="text-xs text-[#4A4A4A]">Conv.</p>
                                <p className="font-bold text-[#FF6B35] font-mono text-sm">
                                  {item.performance.conversions}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 mt-4">
                      <Button variant="ghost" size="sm" icon={<Eye size={14} />} className="flex-1">
                        View
                      </Button>
                      <Button variant="secondary" size="sm" icon={<Edit size={14} />} className="flex-1">
                        Επεξεργασία
                      </Button>
                    </div>
                  </Card>
                </motion.div>
              );
            });
          }).flat()
        )}
      </div>

      {/* Upcoming Months */}
      <Card padding="lg">
        <CardHeader
          title="Upcoming Planning"
          subtitle="Προεπισκόπηση επόμενων μηνών"
          icon={<Calendar size={20} className="text-[#FF6B35]" />}
        />
        <div className="text-center py-8">
          <p className="text-sm text-[#4A4A4A]">
            {contentItems.length > 0 
              ? `Content items are displayed in the calendar above. Total: ${contentItems.length} items.`
              : 'Import content items to see upcoming planning.'}
          </p>
        </div>
      </Card>

      {/* AI Content Generator Panel */}
      {showAIPanel && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
        >
          <Card padding="lg">
            <CardHeader
              title="AI Content Generator"
              subtitle="Generate content variations with AI"
              icon={<Sparkles size={20} className="text-[#FF6B35]" />}
              action={
                <Button variant="ghost" size="sm" onClick={() => setShowAIPanel(false)}>
                  Κλείσιμο
                </Button>
              }
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Input */}
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-[#1A1A1A] mb-2 block">
                    Content Topic
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., Spring Collection Launch"
                    className="w-full px-4 py-2.5 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[#FF6B35] focus:bg-white transition-all"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-[#1A1A1A] mb-2 block">
                    Target Segment
                  </label>
                  <select className="w-full px-4 py-2.5 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[#FF6B35] focus:bg-white transition-all">
                    <option>All Segments</option>
                    {rfmSegments.map((seg) => (
                      <option key={seg.id} value={seg.id}>
                        {seg.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-[#1A1A1A] mb-2 block">
                    Tone of Voice
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {['Professional', 'Friendly', 'Urgent', 'Exclusive', 'Playful'].map((tone) => (
                      <button
                        key={tone}
                        className="px-3 py-1.5 bg-[#F5F5F5] rounded-full text-sm text-[#4A4A4A] hover:bg-[#FF6B35] hover:text-white transition-colors"
                      >
                        {tone}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-[#1A1A1A] mb-2 block">
                    Output Formats
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {['Email', 'Blog', 'Social Media', 'Landing Page', 'Video', 'Newsletter'].map((format) => (
                      <button
                        key={format}
                        className="px-3 py-1.5 bg-[#F5F5F5] rounded-lg text-sm text-[#4A4A4A] hover:bg-[#FF6B35] hover:text-white transition-colors"
                      >
                        {format}
                      </button>
                    ))}
                  </div>
                </div>

                <Button variant="primary" className="w-full" icon={<Sparkles size={16} />}>
                  Generate Content
                </Button>
              </div>

              {/* Preview */}
              <div className="p-6 bg-[#F5F5F5] rounded-xl">
                <div className="flex items-center justify-center h-full min-h-[300px] text-center">
                  <div>
                    <Sparkles size={48} className="text-[#9CA3AF] mx-auto mb-4" />
                    <p className="text-[#4A4A4A]">
                      Configure your content parameters and click Generate to see AI-powered content variations
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
