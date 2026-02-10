import { HelpCircle } from 'lucide-react';
import type { ReactNode } from 'react';

interface TooltipProps {
  content: string;
  children?: ReactNode;
  size?: number;
}

export function Tooltip({ content, children, size = 14 }: TooltipProps) {
  return (
    <span className="inline-flex items-center gap-1.5" title={content}>
      {children}
      <HelpCircle size={size} className="text-[#9CA3AF] hover:text-[#6B7280] flex-shrink-0 cursor-help" />
    </span>
  );
}
