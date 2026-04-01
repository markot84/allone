import buildInfo from '../../generated/buildInfo.json';

/**
 * `onLight`: πλήρες lockup `/Performance.png` (login, marketing, legal).
 * `onDark`: εικονίδιο από το ίδιο PNG (clip αριστερά) + λευκό «Performance» + πορτοκαλί «+» — για σκούρο app chrome.
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
  const fontSize = Math.round(height * 0.46);

  if (variant === 'onDark') {
    return (
      <div
        className={`perf-plus-logo perf-plus-logo--on-dark flex items-center gap-1.5 ${className}`}
        style={{ height }}
        role="img"
        aria-label="Performance+ by notthesame.ai"
      >
        <div className="shrink-0 overflow-hidden" style={{ height, width: height }}>
          <img
            src={lockupSrc}
            alt=""
            className="block h-full w-auto max-w-none select-none"
            style={{ height: '100%', width: 'auto' }}
            draggable={false}
            aria-hidden
          />
        </div>
        <span
          className="perf-plus-logo-word font-bold tracking-tight whitespace-nowrap leading-none font-sans"
          style={{ fontSize }}
        >
          Performance
        </span>
        <span className="perf-plus-logo-plus font-bold leading-none font-sans" style={{ fontSize }}>
          +
        </span>
      </div>
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
