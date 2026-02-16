import { motion } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

interface SliderProps {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  color?: string;
  icon?: ReactNode;
  tooltip?: string;
  disabled?: boolean;
}

export function Slider({
  id,
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  color = '#FF6B35',
  icon,
  tooltip,
  disabled = false
}: SliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;
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
    <div className={`${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {icon && <span className="text-[var(--nts-medium-gray)]">{icon}</span>}
          <label htmlFor={id} className="text-sm font-medium text-[#1A1A1A]">
            {label}
          </label>
          {tooltip && (
            <div 
              ref={triggerRef}
              className="relative inline-flex"
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onFocus={handleMouseEnter}
              onBlur={handleMouseLeave}
            >
              <Info 
                size={14} 
                className="text-[#9CA3AF] hover:text-[#6B7280] cursor-help flex-shrink-0 transition-colors" 
                aria-label="More information"
              />
              {showTooltip && (
                <div
                  ref={tooltipRef}
                  className="fixed z-[99999] px-3 py-2 bg-[#1A1A1A] text-white text-xs rounded-lg shadow-lg pointer-events-none"
                  style={{
                    whiteSpace: 'normal',
                    wordWrap: 'break-word',
                    maxWidth: '400px',
                    minWidth: '250px',
                    width: 'max-content',
                  }}
                >
                  {tooltip}
                  <div className="tooltip-arrow absolute left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1A1A1A]" />
                </div>
              )}
            </div>
          )}
        </div>
        <motion.span
          key={value}
          initial={{ scale: 1.2 }}
          animate={{ scale: 1 }}
          className="font-mono text-sm font-semibold"
          style={{ color }}
        >
          {value}%
        </motion.span>
      </div>
      <div className="relative">
        <div className="h-2 bg-[#E5E5E5] rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: color }}
            initial={false}
            animate={{ width: `${percentage}%` }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        </div>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          style={{ margin: 0 }}
        />
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 shadow-md pointer-events-none"
          style={{ 
            borderColor: color,
            left: `calc(${percentage}% - 8px)`
          }}
          initial={false}
          animate={{ left: `calc(${percentage}% - 8px)` }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
      </div>
    </div>
  );
}
