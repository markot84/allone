import { HelpCircle } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';

interface TooltipProps {
  content: string;
  children?: ReactNode;
  size?: number;
}

export function Tooltip({ content, children, size = 14 }: TooltipProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!showTooltip || !tooltipRef.current || !triggerRef.current) return;

    const tooltip = tooltipRef.current;
    const trigger = triggerRef.current;
    const rect = trigger.getBoundingClientRect();
    
    // Use fixed positioning to avoid overflow issues
    tooltip.style.position = 'fixed';
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'block';
    const tooltipRect = tooltip.getBoundingClientRect();
    tooltip.style.visibility = 'visible';
    
    const tooltipWidth = tooltipRect.width;
    const tooltipHeight = tooltipRect.height;
    
    // Calculate position relative to viewport (fixed positioning)
    const centerX = rect.left + rect.width / 2;
    const topY = rect.top;
    
    // Always position tooltip above
    let leftPos = centerX - tooltipWidth / 2;
    let topPos = topY - tooltipHeight - 8;
    
    // Adjust horizontal position to stay within viewport
    if (leftPos < 8) {
      leftPos = 8;
    } else if (leftPos + tooltipWidth > window.innerWidth - 8) {
      leftPos = window.innerWidth - tooltipWidth - 8;
    }
    
    // If not enough space above, position below
    if (topPos < 8) {
      topPos = rect.bottom + 8;
    }
    
    tooltip.style.left = `${leftPos}px`;
    tooltip.style.top = `${topPos}px`;
    tooltip.style.transform = 'none';
    
    // Arrow always points down (from tooltip to trigger)
    const arrow = tooltip.querySelector('.tooltip-arrow') as HTMLElement;
    if (arrow) {
      const arrowLeft = centerX - leftPos;
      arrow.style.left = `${arrowLeft}px`;
      arrow.style.top = topPos < rect.top ? '100%' : 'auto';
      arrow.style.bottom = topPos < rect.top ? 'auto' : '100%';
      arrow.className = topPos < rect.top 
        ? 'tooltip-arrow absolute left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1A1A1A]'
        : 'tooltip-arrow absolute left-1/2 -translate-x-1/2 border-4 border-transparent border-b-[#1A1A1A]';
    }
  }, [showTooltip]);

  const handleMouseEnter = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    setShowTooltip(true);
  };

  const handleMouseLeave = () => {
    // Small delay to prevent flickering
    timeoutRef.current = window.setTimeout(() => {
      setShowTooltip(false);
    }, 100);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <span 
      ref={triggerRef}
      className="inline-flex items-center gap-1.5 relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
    >
      {children}
      <HelpCircle 
        size={size} 
        className="text-[#9CA3AF] hover:text-[#6B7280] flex-shrink-0 cursor-help transition-colors" 
        aria-label="More information"
      />
      {showTooltip && (
        <div
          ref={tooltipRef}
          className="fixed z-[99999] px-3 py-2 bg-[#1A1A1A] text-white text-xs rounded-lg shadow-lg pointer-events-none"
          style={{
            whiteSpace: 'pre-line',
            wordWrap: 'break-word',
            maxWidth: '400px',
            minWidth: '250px',
            width: 'max-content',
          }}
        >
          {content}
          <div className="tooltip-arrow absolute left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1A1A1A]" />
        </div>
      )}
    </span>
  );
}
