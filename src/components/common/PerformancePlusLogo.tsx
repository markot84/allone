import buildInfo from '../../generated/buildInfo.json';

/**
 * `onLight`: σύνθετο lockup για ανοιχτό φόντο (τετράγωνο σήμα ≠ + τυπογραφικό)·
 * το αρχείο `/Performance.png` προορίζεται για σκούρο φόντο (λευκό wordmark).
 * `onDark`: ράστερ lockup `/Performance.png` (sidebar, header σκούρο).
 */
export interface PerformancePlusLogoProps {
  className?: string;
  height?: number;
  variant?: 'onDark' | 'onLight';
}

/** Ίδιο οπτικό με την εφαρμογή: πορτοκαλί squircle + λευκό ≠ + σκούρο «Performance» και πορτοκαλί «+». */
function PerformancePlusLockupLight({ height, className }: { height: number; className: string }) {
  const box = Math.max(28, Math.round(height * 0.96));
  const symbolPx = Math.max(15, Math.round(box * 0.46));
  const textPx = Math.max(14, Math.round(height * 0.44));
  const gap = Math.max(6, Math.round(height * 0.2));

  return (
    <div
      role="img"
      aria-label="Performance+ by notthesame.ai"
      className={`inline-flex items-center ${className}`.trim()}
      style={{ gap }}
    >
      <span
        className="flex shrink-0 select-none items-center justify-center rounded-[12px] bg-[var(--nts-accent)] font-semibold leading-none text-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.07]"
        style={{ width: box, height: box, fontSize: symbolPx }}
        aria-hidden
      >
        ≠
      </span>
      <span
        className="shrink-0 select-none font-bold leading-none tracking-tight text-[#111827]"
        style={{ fontSize: textPx }}
      >
        Performance
        <span className="text-[var(--nts-accent)]">+</span>
      </span>
    </div>
  );
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
        className={`block h-auto w-auto max-w-[min(100%,340px)] object-contain object-left ${className}`}
        style={{ height }}
        loading="eager"
        decoding="async"
      />
    );
  }

  return <PerformancePlusLockupLight height={height} className={className} />;
}
