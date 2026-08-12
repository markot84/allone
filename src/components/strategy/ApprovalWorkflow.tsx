import { motion } from 'framer-motion';
import { Check, CheckCircle2, ChevronDown, Clock, FileText, Rocket } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../common';

type ApprovalStatus = 'draft' | 'pending_review' | 'approved' | 'implementing';

interface ApprovalWorkflowProps {
  status: ApprovalStatus;
  onStatusChange: (status: ApprovalStatus) => void;
}

const statusConfig = {
  draft: {
    label: 'Προσχέδιο',
    icon: <FileText size={14} className="text-[var(--nts-medium-gray)]" />,
    color: '#4A4A4A',
    bgColor: '#F5F5F5'
  },
  pending_review: {
    label: 'Σε Αναμονή Αξιολόγησης',
    icon: <Clock size={14} className="text-[var(--nts-medium-gray)]" />,
    color: '#F59E0B',
    bgColor: '#FEF3C7'
  },
  approved: {
    label: 'Εγκεκριμένο',
    icon: <CheckCircle2 size={14} className="text-[var(--nts-medium-gray)]" />,
    color: '#22C55E',
    bgColor: '#DCFCE7'
  },
  implementing: {
    label: 'Σε Εφαρμογή',
    icon: <Rocket size={14} className="text-[var(--nts-medium-gray)]" />,
    color: '#6B7280',
    bgColor: '#F3F4F6'
  }
};

export function ApprovalWorkflow({ status, onStatusChange }: ApprovalWorkflowProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<{ top: number; right: number; minWidth: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const config = statusConfig[status];

  useEffect(() => {
    if (showDropdown && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropdownStyle({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
        minWidth: Math.max(192, rect.width)
      });
    } else {
      setDropdownStyle(null);
    }
  }, [showDropdown]);

  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showDropdown) return;
    const onOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setShowDropdown(false);
    };
    document.addEventListener('click', onOutside, { capture: true });
    return () => document.removeEventListener('click', onOutside, { capture: true });
  }, [showDropdown]);

  const getNextAction = () => {
    switch (status) {
      case 'draft':
        return { label: 'Αποστολή για αξιολόγηση', nextStatus: 'pending_review' as ApprovalStatus };
      case 'pending_review':
        return { label: 'Έγκριση και ενεργοποίηση', nextStatus: 'approved' as ApprovalStatus };
      case 'approved':
        return { label: 'Έναρξη εφαρμογής', nextStatus: 'implementing' as ApprovalStatus };
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
      <div className="hidden lg:flex items-center gap-1 flex-wrap max-w-full overflow-x-auto">
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
          ref={btnRef}
          onClick={(e) => {
            e.stopPropagation();
            setShowDropdown((v) => !v);
          }}
          className="p-2 rounded-lg hover:bg-[#F5F5F5] transition-colors"
        >
          <ChevronDown size={16} className="text-[var(--text-secondary)]" />
        </button>

        {showDropdown && dropdownStyle &&
          createPortal(
            <motion.div
              ref={dropdownRef}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="fixed bg-white rounded-lg shadow-lg border border-[#E5E5E5] py-1 z-[1000] max-h-[280px] overflow-y-auto"
              style={{
                top: dropdownStyle.top,
                right: dropdownStyle.right,
                minWidth: dropdownStyle.minWidth
              }}
              onClick={(e) => e.stopPropagation()}
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
                    ${key === status ? 'bg-[var(--nts-light-gray)] text-[var(--nts-accent-text)]' : 'text-[#1A1A1A]'}
                  `}
                >
                  <span className="inline-flex shrink-0">{cfg.icon}</span>
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
                ↩️ Επαναφορά σε Προσχέδιο
              </button>
            </motion.div>,
            document.body
          )}
      </div>
    </div>
  );
}
