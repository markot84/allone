import { motion } from 'framer-motion';
import {
  Book,
  Video,
  MessageCircle,
  Mail,
  ExternalLink,
  ChevronRight,
  Search
} from 'lucide-react';
import { Card, CardHeader, Button } from '../common';

const helpCategories = [
  {
    icon: '🎯',
    title: 'Getting Started',
    description: 'Learn the basics of Performance+',
    articles: 12
  },
  {
    icon: '⚙️',
    title: 'Strategy Configuration',
    description: 'Master the weight configurator',
    articles: 8
  },
  {
    icon: '👥',
    title: 'RFM Segmentation',
    description: 'Understand customer segments',
    articles: 15
  },
  {
    icon: '📊',
    title: 'Analytics & Reports',
    description: 'Interpreting your data',
    articles: 10
  },
  {
    icon: '🔗',
    title: 'Integrations',
    description: 'Connect your tools',
    articles: 6
  },
  {
    icon: '🔒',
    title: 'Security & Privacy',
    description: 'Data protection policies',
    articles: 4
  }
];

const popularArticles = [
  'How to configure strategy weights for maximum ROI',
  'Understanding RFM segments and customer behavior',
  'Setting up automated product feed exports',
  'Interpreting the ROI attribution dashboard',
  'Best practices for channel budget allocation'
];

export function Help() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center py-8">
        <h2 className="text-3xl font-bold text-[#1A1A1A]">How can we help?</h2>
        <p className="text-[#4A4A4A] mt-2 max-w-md mx-auto">
          Find answers to your questions or get in touch with our support team
        </p>

        {/* Search */}
        <div className="relative max-w-xl mx-auto mt-6">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
          <input
            type="text"
            placeholder="Search for help articles..."
            className="w-full pl-12 pr-4 py-3 bg-white border border-[#E5E5E5] rounded-xl text-sm focus:outline-none focus:border-[#FF6B35] shadow-sm"
          />
        </div>
      </div>

      {/* Help Categories */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {helpCategories.map((category, index) => (
          <motion.div
            key={category.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card padding="md" hover>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-[#FFF0EB] rounded-xl flex items-center justify-center text-2xl">
                  {category.icon}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-[#1A1A1A]">{category.title}</h3>
                  <p className="text-sm text-[#4A4A4A] mt-1">{category.description}</p>
                  <p className="text-xs text-[#FF6B35] mt-2">{category.articles} articles</p>
                </div>
                <ChevronRight size={18} className="text-[#9CA3AF]" />
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Popular Articles & Contact */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Popular Articles */}
        <Card padding="lg">
          <CardHeader
            title="Popular Articles"
            subtitle="Most viewed help content"
            icon={<Book size={20} className="text-[#FF6B35]" />}
          />
          <div className="space-y-3">
            {popularArticles.map((article, index) => (
              <motion.a
                key={article}
                href="#"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center justify-between p-3 bg-[#F5F5F5] rounded-lg hover:bg-[#FFF0EB] transition-colors group"
              >
                <span className="text-sm text-[#1A1A1A] group-hover:text-[#FF6B35]">
                  {article}
                </span>
                <ChevronRight size={16} className="text-[#9CA3AF] group-hover:text-[#FF6B35]" />
              </motion.a>
            ))}
          </div>
        </Card>

        {/* Contact Support */}
        <Card padding="lg">
          <CardHeader
            title="Contact Support"
            subtitle="We're here to help"
            icon={<MessageCircle size={20} className="text-[#FF6B35]" />}
          />
          <div className="space-y-4">
            <div className="p-4 bg-[#F5F5F5] rounded-xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-[#22C55E]/20 rounded-lg flex items-center justify-center">
                  <MessageCircle size={20} className="text-[#22C55E]" />
                </div>
                <div>
                  <h4 className="font-medium text-[#1A1A1A]">Live Chat</h4>
                  <p className="text-xs text-[#22C55E]">Available now</p>
                </div>
              </div>
              <Button variant="primary" className="w-full">
                Start Chat
              </Button>
            </div>

            <div className="p-4 border border-[#E5E5E5] rounded-xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-[#3B82F6]/20 rounded-lg flex items-center justify-center">
                  <Mail size={20} className="text-[#3B82F6]" />
                </div>
                <div>
                  <h4 className="font-medium text-[#1A1A1A]">Email Support</h4>
                  <p className="text-xs text-[#4A4A4A]">support@notthesame.ai</p>
                </div>
              </div>
              <Button variant="secondary" className="w-full">
                Send Email
              </Button>
            </div>

            <div className="p-4 border border-[#E5E5E5] rounded-xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-[#8B5CF6]/20 rounded-lg flex items-center justify-center">
                  <Video size={20} className="text-[#8B5CF6]" />
                </div>
                <div>
                  <h4 className="font-medium text-[#1A1A1A]">Video Tutorials</h4>
                  <p className="text-xs text-[#4A4A4A]">Learn at your own pace</p>
                </div>
              </div>
              <Button variant="secondary" className="w-full" icon={<ExternalLink size={14} />}>
                Watch Tutorials
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Footer */}
      <div className="text-center py-8 border-t border-[#E5E5E5]">
        <p className="text-[#4A4A4A]">
          Can't find what you're looking for?{' '}
          <a href="mailto:support@notthesame.ai" className="text-[#FF6B35] hover:underline">
            Contact our team
          </a>
        </p>
        <p className="text-xs text-[#9CA3AF] mt-2">
          Performance+ by notthesame.ai | www.notthesame.ai
        </p>
      </div>
    </div>
  );
}
