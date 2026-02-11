import { motion } from 'framer-motion';
import {
  Download,
  Calendar,
  FileText,
  Mail,
  Clock,
  ChevronRight,
  Plus
} from 'lucide-react';
import { Card, CardHeader, Badge, Button } from '../common';
import { useProducts, useSegments, useCampaigns, useAnalytics } from '../../hooks';

const reportTypes = [
  {
    id: 'executive',
    name: 'Executive Summary',
    description: 'High-level KPIs and ROI overview for board presentations',
    icon: '📊',
    format: 'PDF',
    lastGenerated: '2 hours ago'
  },
  {
    id: 'segment',
    name: 'Segment Performance',
    description: 'Detailed RFM segment analysis with migration trends',
    icon: '👥',
    format: 'PDF/Excel',
    lastGenerated: '1 day ago'
  },
  {
    id: 'inventory',
    name: 'Inventory Health',
    description: 'Stock levels, aging analysis, and optimization opportunities',
    icon: '📦',
    format: 'Excel',
    lastGenerated: '3 hours ago'
  },
  {
    id: 'channel',
    name: 'Channel Attribution',
    description: 'ROAS breakdown and budget allocation analysis',
    icon: '📢',
    format: 'PDF/Excel',
    lastGenerated: '6 hours ago'
  },
  {
    id: 'campaign',
    name: 'Campaign Performance',
    description: 'Detailed results for all marketing campaigns',
    icon: '🎯',
    format: 'Excel',
    lastGenerated: '12 hours ago'
  },
  {
    id: 'product',
    name: 'Product Prioritization',
    description: 'Current scoring and ranking based on strategy weights',
    icon: '🏷️',
    format: 'Excel/CSV',
    lastGenerated: '1 hour ago'
  }
];

const scheduledReports = [
  {
    name: 'Weekly Executive Summary',
    frequency: 'Every Monday 9:00 AM',
    recipients: ['ceo@company.com', 'cmo@company.com'],
    status: 'active'
  },
  {
    name: 'Daily Inventory Alert',
    frequency: 'Daily 8:00 AM',
    recipients: ['operations@company.com'],
    status: 'active'
  },
  {
    name: 'Monthly Performance Review',
    frequency: 'First Monday of month',
    recipients: ['team@company.com'],
    status: 'active'
  }
];

export function Reports() {
  const { count: productsCount } = useProducts();
  const { segments } = useSegments();
  const segmentsCount = segments.length;
  const { campaigns } = useCampaigns();
  const { hasImported: hasAnalytics } = useAnalytics();

  const reportDataCounts: Record<string, number | string> = {
    executive: hasAnalytics ? '✓' : 0,
    segment: segmentsCount,
    inventory: productsCount,
    channel: hasAnalytics ? '✓' : 0,
    campaign: campaigns.length,
    product: productsCount
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">Reports & Analytics</h2>
          <p className="text-[#4A4A4A] mt-1">
            Generate, schedule, and export performance reports
          </p>
        </div>
        <Button variant="primary" icon={<Plus size={16} />}>
          Custom Report
        </Button>
      </div>

      {/* Report Types */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reportTypes.map((report, index) => (
          <motion.div
            key={report.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card padding="md" hover>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-[#FFF0EB] rounded-xl flex items-center justify-center text-2xl">
                  {report.icon}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-[#1A1A1A]">{report.name}</h3>
                  <p className="text-sm text-[#4A4A4A] mt-1">{report.description}</p>
                  
                  <div className="flex items-center gap-3 mt-3">
                    <Badge variant="default" size="sm">{report.format}</Badge>
                    {reportDataCounts[report.id] !== undefined && (
                      <span className="text-xs text-[#4A4A4A]">
                        Data: {typeof reportDataCounts[report.id] === 'number'
                          ? reportDataCounts[report.id].toLocaleString()
                          : reportDataCounts[report.id]}
                      </span>
                    )}
                    <span className="text-xs text-[#9CA3AF]">
                      Last: {report.lastGenerated}
                    </span>
                  </div>

                  <div className="flex gap-2 mt-4">
                    <Button variant="primary" size="sm" icon={<Download size={14} />}>
                      Generate
                    </Button>
                    <Button variant="ghost" size="sm" icon={<Calendar size={14} />}>
                      Schedule
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Scheduled Reports */}
      <Card padding="lg">
        <CardHeader
          title="Scheduled Reports"
          subtitle="Automated report delivery"
          icon={<Clock size={20} className="text-[#FF6B35]" />}
          action={
            <Button variant="secondary" size="sm" icon={<Plus size={14} />}>
              New Schedule
            </Button>
          }
        />
        <div className="space-y-4">
          {scheduledReports.map((report, index) => (
            <motion.div
              key={report.name}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className="flex items-center justify-between p-4 bg-[#F5F5F5] rounded-xl"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
                  <FileText size={20} className="text-[#FF6B35]" />
                </div>
                <div>
                  <h4 className="font-medium text-[#1A1A1A]">{report.name}</h4>
                  <div className="flex items-center gap-4 mt-1">
                    <span className="text-xs text-[#4A4A4A] flex items-center gap-1">
                      <Clock size={12} />
                      {report.frequency}
                    </span>
                    <span className="text-xs text-[#4A4A4A] flex items-center gap-1">
                      <Mail size={12} />
                      {report.recipients.length} recipients
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="success" size="sm">Active</Badge>
                <button className="p-2 hover:bg-white rounded-lg transition-colors">
                  <ChevronRight size={16} className="text-[#4A4A4A]" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card padding="md">
          <div className="text-center">
            <p className="text-3xl font-bold text-[#1A1A1A] font-mono">{productsCount}</p>
            <p className="text-sm text-[#4A4A4A] mt-1">Products</p>
            <p className="text-xs text-[#22C55E]">In catalog</p>
          </div>
        </Card>
        <Card padding="md">
          <div className="text-center">
            <p className="text-3xl font-bold text-[#1A1A1A] font-mono">{segmentsCount}</p>
            <p className="text-sm text-[#4A4A4A] mt-1">Segments</p>
            <p className="text-xs text-[#3B82F6]">RFM</p>
          </div>
        </Card>
        <Card padding="md">
          <div className="text-center">
            <p className="text-3xl font-bold text-[#1A1A1A] font-mono">{campaigns.length}</p>
            <p className="text-sm text-[#4A4A4A] mt-1">Campaigns</p>
            <p className="text-xs text-[#8B5CF6]">Active</p>
          </div>
        </Card>
        <Card padding="md">
          <div className="text-center">
            <p className="text-3xl font-bold text-[#1A1A1A] font-mono">{hasAnalytics ? '✓' : '—'}</p>
            <p className="text-sm text-[#4A4A4A] mt-1">Analytics</p>
            <p className="text-xs text-[#22C55E]">{hasAnalytics ? 'Imported' : 'No data'}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
