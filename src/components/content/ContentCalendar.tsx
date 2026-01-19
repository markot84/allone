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
import { contentCalendar, upcomingMonths, contentFormats } from '../../data/mockCalendar';
import { rfmSegments } from '../../data/mockSegments';

const statusConfig = {
  draft: { label: 'Draft', color: '#4A4A4A', bgColor: '#F5F5F5', icon: <FileText size={12} /> },
  in_production: { label: 'In Production', color: '#3B82F6', bgColor: '#DBEAFE', icon: <Edit size={12} /> },
  scheduled: { label: 'Scheduled', color: '#8B5CF6', bgColor: '#EDE9FE', icon: <Clock size={12} /> },
  published: { label: 'Published', color: '#22C55E', bgColor: '#DCFCE7', icon: <Check size={12} /> }
};

export function ContentCalendar() {
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [showAIPanel, setShowAIPanel] = useState(false);

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
            <h3 className="text-xl font-bold text-[#1A1A1A]">{contentCalendar.month}</h3>
            <p className="text-sm text-[#4A4A4A]">
              Theme: {contentCalendar.theme} | Focus: {contentCalendar.customer_journey_focus}
            </p>
          </div>
          <button className="p-2 rounded-lg hover:bg-[#F5F5F5] transition-colors">
            <ChevronRight size={20} className="text-[#4A4A4A]" />
          </button>
        </div>
      </Card>

      {/* Calendar Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {contentCalendar.content_items.map((item, index) => {
          const status = statusConfig[item.status];
          const isSelected = selectedWeek === item.week;

          return (
            <motion.div
              key={item.week}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card
                padding="md"
                hover
                onClick={() => setSelectedWeek(isSelected ? null : item.week)}
                className={isSelected ? 'ring-2 ring-[#FF6B35]' : ''}
              >
                <div className="flex items-center justify-between mb-3">
                  <Badge variant="orange">Week {item.week}</Badge>
                  <div
                    className="flex items-center gap-1 px-2 py-1 rounded-full text-xs"
                    style={{ backgroundColor: status.bgColor, color: status.color }}
                  >
                    {status.icon}
                    {status.label}
                  </div>
                </div>

                <h4 className="font-semibold text-[#1A1A1A] mb-2">{item.topic}</h4>

                <div className="space-y-3">
                  {/* Formats */}
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

                  {/* Segments */}
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
                              backgroundColor: segment ? `${segment.color}20` : '#F5F5F5',
                              color: segment?.color || '#4A4A4A'
                            }}
                          >
                            {segment?.icon} {seg}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  {/* Performance (if published) */}
                  {item.performance && (
                    <div className="pt-3 border-t border-[#E5E5E5]">
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-xs text-[#4A4A4A]">Views</p>
                          <p className="font-bold text-[#1A1A1A] font-mono text-sm">
                            {item.performance.views.toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-[#4A4A4A]">Engagement</p>
                          <p className="font-bold text-[#22C55E] font-mono text-sm">
                            {item.performance.engagement}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-[#4A4A4A]">Conv.</p>
                          <p className="font-bold text-[#FF6B35] font-mono text-sm">
                            {item.performance.conversions}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 mt-4">
                  <Button variant="ghost" size="sm" icon={<Eye size={14} />} className="flex-1">
                    View
                  </Button>
                  <Button variant="secondary" size="sm" icon={<Edit size={14} />} className="flex-1">
                    Edit
                  </Button>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* Upcoming Months */}
      <Card padding="lg">
        <CardHeader
          title="Upcoming Planning"
          subtitle="Preview of next months"
          icon={<Calendar size={20} className="text-[#FF6B35]" />}
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {upcomingMonths.map((month, index) => (
            <motion.div
              key={month.month}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="p-4 border border-[#E5E5E5] rounded-xl hover:border-[#FF6B35] hover:shadow-sm transition-all"
            >
              <h4 className="font-semibold text-[#1A1A1A]">{month.month}</h4>
              <p className="text-sm text-[#FF6B35] mt-1">{month.theme}</p>
              <p className="text-xs text-[#4A4A4A] mt-2">{month.focus}</p>
              <div className="flex flex-wrap gap-1 mt-3">
                {month.key_events.map((event) => (
                  <Badge key={event} variant="info" size="sm">{event}</Badge>
                ))}
              </div>
            </motion.div>
          ))}
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
                  Close
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
                        {seg.icon} {seg.name}
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
                    {contentFormats.slice(0, 8).map((format) => (
                      <button
                        key={format.id}
                        className="px-3 py-1.5 bg-[#F5F5F5] rounded-lg text-sm text-[#4A4A4A] hover:bg-[#FF6B35] hover:text-white transition-colors flex items-center gap-1"
                      >
                        {format.icon} {format.name}
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
