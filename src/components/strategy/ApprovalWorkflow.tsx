import { motion } from 'framer-motion';
import { Check, CheckCircle2, ChevronDown, Clock, FileText, Rocket } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../common';

type ApprovalStatus = 'draft' | 'pending_review' | 'approved' | 'implementing';

interface ApprovalWorkflowProps {
  status: ApprovalStatus;
  onStatusChange: (status: ApprovalStatus) => void;
}

const statusConfig = {
  draft: {
    label: 'Draft',
    icon: <FileText size={14} className="text-[var(--nts-medium-gray)]" />,
    color: '#4A4A4A',
    bgColor: '#F5F5F5'
  },
  pending_review: {
    label: 'Pending Review',
    icon: <Clock size={14} className="text-[var(--nts-medium-gray)]" />,
    color: '#F59E0B',
    bgColor: '#FEF3C7'
  },
  approved: {
    label: 'Approved',
    icon: <CheckCircle2 size={14} className="text-[var(--nts-medium-gray)]" />,
    color: '#22C55E',
    bgColor: '#DCFCE7'
  },
  implementing: {
    label: 'In Implementation',
    icon: <Rocket size={14} className="text-[var(--nts-medium-gray)]" />,
    color: '#3B82F6',
    bgColor: '#DBEAFE'
  }
};

export function ApprovalWorkflow({ status, onStatusChange }: ApprovalWorkflowProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const config = statusConfig[status];

  const getNextAction = () => {
    switch (status) {
      case 'draft':
        return { label: 'Send for Review', nextStatus: 'pending_review' as ApprovalStatus };
      case 'pending_review':
        return { label: 'Approve & Activate', nextStatus: 'approved' as ApprovalStatus };
      case 'approved':
        return { label: 'Start Implementation', nextStatus: 'implementing' as ApprovalStatus };
      case 'implementing':
        return null;
    }
  };

  const nextAction = getNextAction();

  return (
    <div className="flex items-center gap-3 max-w-full overflow-x-hidden flex-wrap">
      {/* Status Badge */}
      <motion.div
        key={status}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--nts-border-gray)] bg-[var(--nts-light-gray)]"
      >
        <span className="inline-flex">{config.icon}</span>
        <span className="text-sm font-medium text-[var(--nts-medium-gray)]">
          {config.label}
        </span>
      </motion.div>

      {/* Workflow Steps */}
      <div className="hidden md:flex items-center gap-1 flex-wrap max-w-full overflow-x-auto">
        {Object.entries(statusConfig).map(([key], index) => {
          const isActive = key === status;
          const isPast = Object.keys(statusConfig).indexOf(status) > index;
          
          return (
            <div key={key} className="flex items-center">
              <motion.div
                className={`
                  w-6 h-6 rounded-full flex items-center justify-center text-xs border
                  ${isPast ? 'bg-white border-[var(--nts-border-gray)] text-[var(--nts-medium-gray)]' : isActive ? 'bg-white border-[var(--nts-border-gray)] text-[var(--nts-charcoal)]' : 'bg-[var(--nts-light-gray)] border-[var(--nts-border-gray)] text-[var(--nts-medium-gray)]'}
                `}
                animate={{ scale: isActive ? 1.1 : 1 }}
              >
                {isPast ? <Check size={12} /> : index + 1}
              </motion.div>
              {index < Object.keys(statusConfig).length - 1 && (
                <div
                  className={`w-8 h-0.5 ${isPast ? 'bg-[var(--nts-border-gray)]' : 'bg-[var(--nts-border-gray)]'}`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Action Button */}
      {nextAction && (
        <div className="relative">
          <Button
            variant="primary"
            size="sm"
            onClick={() => onStatusChange(nextAction.nextStatus)}
          >
            {nextAction.label}
          </Button>
        </div>
      )}

      {/* Quick Actions Dropdown */}
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="p-2 rounded-lg hover:bg-[#F5F5F5] transition-colors"
        >
          <ChevronDown size={16} className="text-[#4A4A4A]" />
        </button>

        {showDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute right-0 top-full mt-2 w-48 bg-white rounded-lg shadow-lg border border-[#E5E5E5] py-1 z-10"
          >
            {Object.entries(statusConfig).map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => {
                  onStatusChange(key as ApprovalStatus);
                  setShowDropdown(false);
                }}
                className={`
                  w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-[#F5F5F5]
                  ${key === status ? 'bg-[#FFF0EB] text-[#FF6B35]' : 'text-[#1A1A1A]'}
                `}
              >
                <span className="inline-flex">{cfg.icon}</span>
                {cfg.label}
              </button>
            ))}
            <div className="border-t border-[#E5E5E5] my-1" />
            <button
              onClick={() => {
                onStatusChange('draft');
                setShowDropdown(false);
              }}
              className="w-full px-4 py-2 text-left text-sm text-[#EF4444] hover:bg-[#FEE2E2] flex items-center gap-2"
            >
              ↩️ Reset to Draft
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
