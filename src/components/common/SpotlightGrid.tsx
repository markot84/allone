import { useCallback, useRef, type CSSProperties, type ReactNode } from 'react';

interface SpotlightGridProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Diameter of the light, in px. Larger grids want a larger light or it reads as a dot. */
  size?: number;
}

/**
 * A soft light that follows the pointer across a grid of `.surface` cards.
 *
 * The card under the cursor is lit rather than merely hovered, and because there is one light over
 * the whole grid instead of a highlight per card, moving across the grid reads as continuous
 * movement rather than as tiles switching on and off.
 *
 * The position is written straight to CSS custom properties on the grid element. Routing it through
 * React state instead would re-render every card in the grid on every pointer move — at 4.500 SKUs
 * on the products page that is the difference between free and unusable. Nothing here re-renders;
 * the only React work is attaching the listeners once.
 *
 * In the light theme `--spotlight-color` is transparent, so this costs two property writes and
 * paints nothing. That is deliberate: a wash this soft is invisible on white and forcing it up to
 * where it would show only muddies the surface.
 */
export function SpotlightGrid({ children, className = '', style, size = 420 }: SpotlightGridProps) {
  const ref = useRef<HTMLDivElement>(null);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty('--spotlight-x', `${event.clientX - rect.left}px`);
    node.style.setProperty('--spotlight-y', `${event.clientY - rect.top}px`);
  }, []);

  // The gradient is always painted; only its opacity is animated, so the light fades in and out at
  // the grid's edge instead of appearing wherever the pointer happens to enter.
  const handlePointerEnter = useCallback(() => {
    ref.current?.setAttribute('data-pointer-inside', 'true');
  }, []);

  const handlePointerLeave = useCallback(() => {
    ref.current?.setAttribute('data-pointer-inside', 'false');
  }, []);

  return (
    <div
      ref={ref}
      className={`spotlight-grid ${className}`.trim()}
      style={{ ...style, ['--spotlight-size' as string]: `${size}px` }}
      onPointerMove={handlePointerMove}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      {children}
    </div>
  );
}
