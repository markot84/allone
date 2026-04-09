import buildInfo from '../../generated/buildInfo.json';

/**
 * `onLight`: πλήρες lockup `/Performance.png` (login, marketing, legal).
 * `onDark`: ίδιο επίσημο lockup `/Performance.png` για συνέπεια brand στο app chrome.
 */
export interface PerformancePlusLogoProps {
  className?: string;
  height?: number;
  variant?: 'onDark' | 'onLight';
}

export function PerformancePlusLogo({
  className = '',
  height = 36,
  variant = 'onLight',
}: PerformancePlusLogoProps) {
  const v = encodeURIComponent(buildInfo.version);
  const lockupSrc = `/Performance.png?v=${v}`;

  if (variant === 'onDark') {
    return (
      <img
        src={lockupSrc}
        alt="Performance+ by notthesame.ai"
        className={`block w-auto max-w-[min(100%,340px)] object-contain object-left ${className}`}
        style={{ height }}
        loading="eager"
        decoding="async"
      />
    );
  }

  return (
    <img
      src={lockupSrc}
      alt="Performance+ by notthesame.ai"
      className={`block w-auto max-w-[min(100%,min(92vw,320px))] object-contain object-left ${className}`}
      style={{ height }}
      loading="eager"
      decoding="async"
    />
  );
}
