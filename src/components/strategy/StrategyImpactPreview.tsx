import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  Package,
  FileText,
  Megaphone,
  TrendingUp,
  TrendingDown,
  Pause,
  Play,
  Check
} from 'lucide-react';
import { Badge, Button } from '../common';
import { strategyChangeImpact } from '../../data/mockContent';

interface StrategyImpactPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function StrategyImpactPreview({ isOpen, onClose, onConfirm }: StrategyImpactPreviewProps) {
  if (!isOpen) return null;

  const { from, to, impacts } = strategyChangeImpact;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-[#E5E5E5]">
          <div className="flex items-center gap-4">
            <AlertTriangle size={24} className="text-[#F59E0B]" />
            <div>
              <h2 className="text-xl font-bold text-[#1A1A1A]">Strategy Change Impact Preview</h2>
              <p className="text-[#4A4A4A]">Review the effects before applying this change</p>
            </div>
          </div>

          {/* From → To */}
          <div className="flex items-center gap-4 mt-6 p-4 bg-[#F5F5F5] rounded-xl">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{from.icon}</span>
              <span className="font-medium text-[#1A1A1A]">{from.name}</span>
            </div>
            <ArrowRight size={24} className="text-[#FF6B35]" />
            <div className="flex items-center gap-2">
              <span className="text-2xl">{to.icon}</span>
              <span className="font-medium text-[#1A1A1A]">{to.name}</span>
            </div>
          </div>
        </div>

        {/* Impact Sections */}
        <div className="p-6 space-y-6">
          {/* Products Impact */}
          <div className="p-4 border border-[#E5E5E5] rounded-xl">
            <div className="flex items-center gap-2 mb-4">
              <Package size={18} className="text-[#3B82F6]" />
              <h3 className="font-semibold text-[#1A1A1A]">Product Prioritization</h3>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="p-3 bg-[#FEE2E2] rounded-lg">
                <div className="flex items-center gap-2">
                  <TrendingDown size={16} className="text-[#EF4444]" />
                  <span className="text-sm font-medium text-[#991B1B]">Will Deprioritize</span>
                </div>
                <p className="text-2xl font-bold text-[#EF4444] mt-1">{impacts.products.will_deprioritize}</p>
                <p className="text-xs text-[#991B1B]">products</p>
              </div>
              <div className="p-3 bg-[#DCFCE7] rounded-lg">
                <div className="flex items-center gap-2">
                  <TrendingUp size={16} className="text-[#22C55E]" />
                  <span className="text-sm font-medium text-[#166534]">Will Prioritize</span>
                </div>
                <p className="text-2xl font-bold text-[#22C55E] mt-1">{impacts.products.will_prioritize}</p>
                <p className="text-xs text-[#166534]">products</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {impacts.products.samples.map((sample, i) => (
                <Badge 
                  key={i} 
                  variant={sample.change === 'prioritize' ? 'success' : 'danger'}
                  size="sm"
                >
                  {sample.change === 'prioritize' ? '↑' : '↓'} {sample.name}
                </Badge>
              ))}
            </div>
          </div>

          {/* Content Impact */}
          <div className="p-4 border border-[#E5E5E5] rounded-xl">
            <div className="flex items-center gap-2 mb-4">
              <FileText size={18} className="text-[#8B5CF6]" />
              <h3 className="font-semibold text-[#1A1A1A]">Content Alignment</h3>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center p-3 bg-[#DCFCE7] rounded-lg">
                <p className="text-xl font-bold text-[#22C55E]">{impacts.content.aligned}</p>
                <p className="text-xs text-[#166534]">Still aligned</p>
              </div>
              <div className="text-center p-3 bg-[#FEF3C7] rounded-lg">
                <p className="text-xl font-bold text-[#F59E0B]">{impacts.content.needs_review}</p>
                <p className="text-xs text-[#92400E]">Needs review</p>
              </div>
              <div className="text-center p-3 bg-[#F5F5F5] rounded-lg">
                <p className="text-xl font-bold text-[#4A4A4A]">{impacts.content.on_hold}</p>
                <p className="text-xs text-[#4A4A4A]">On hold</p>
              </div>
            </div>
            <div className="space-y-2">
              {impacts.content.affected_items.map((item, i) => (
                <div 
                  key={i} 
                  className={`flex items-center justify-between p-2 rounded-lg ${
                    item.status === 'will_activate' ? 'bg-[#DCFCE7]' : 'bg-[#FEF3C7]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {item.status === 'will_activate' ? (
                      <Play size={14} className="text-[#22C55E]" />
                    ) : (
                      <Pause size={14} className="text-[#F59E0B]" />
                    )}
                    <span className="text-sm text-[#1A1A1A]">{item.title}</span>
                  </div>
                  <span className="text-xs text-[#4A4A4A]">{item.reason}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Campaigns Impact */}
          <div className="p-4 border border-[#E5E5E5] rounded-xl">
            <div className="flex items-center gap-2 mb-4">
              <Megaphone size={18} className="text-[#FF6B35]" />
              <h3 className="font-semibold text-[#1A1A1A]">Active Campaigns</h3>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-[#DBEAFE] rounded-lg">
                <p className="text-xl font-bold text-[#3B82F6]">{impacts.campaigns.active}</p>
                <p className="text-xs text-[#1E40AF]">Currently active</p>
              </div>
              <div className="text-center p-3 bg-[#FEF3C7] rounded-lg">
                <p className="text-xl font-bold text-[#F59E0B]">{impacts.campaigns.will_pause}</p>
                <p className="text-xs text-[#92400E]">Will pause</p>
              </div>
              <div className="text-center p-3 bg-[#FFF0EB] rounded-lg">
                <p className="text-xl font-bold text-[#FF6B35]">{impacts.campaigns.will_adjust}</p>
                <p className="text-xs text-[#C2410C]">Will adjust</p>
              </div>
            </div>
          </div>

          {/* Estimated Impact */}
          <div className="p-4 bg-gradient-to-r from-[#F5F5F5] to-white rounded-xl border border-[#E5E5E5]">
            <h3 className="font-semibold text-[#1A1A1A] mb-3">Estimated Business Impact</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-lg font-bold text-[#22C55E]">{impacts.estimated_impact.margin}</p>
                <p className="text-xs text-[#4A4A4A]">Margin</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-[#EF4444]">{impacts.estimated_impact.volume}</p>
                <p className="text-xs text-[#4A4A4A]">Volume</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-[#3B82F6]">{impacts.estimated_impact.revenue}</p>
                <p className="text-xs text-[#4A4A4A]">Net Revenue</p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-6 border-t border-[#E5E5E5] flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Check size={16} />} onClick={onConfirm}>
            Confirm Strategy Change
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
