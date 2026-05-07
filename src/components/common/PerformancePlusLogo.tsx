import buildInfo from '../../generated/buildInfo.json';

/**
 * `onLight`: η εικόνα Performance.png σε σκούρο pill — ακριβώς όπως εμφανίζεται στο sidebar.
 * `onDark`:  η εικόνα Performance.png απευθείας πάνω σε σκούρο φόντο (sidebar, dark header).
 *
 * Και οι δύο παραλλαγές χρησιμοποιούν το επίσημο asset· δεν υπάρχει SVG/HTML proxy.
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
        className={`block h-auto w-auto max-w-[min(100%,340px)] object-contain object-left ${className}`}
        style={{ height }}
        loading="eager"
        decoding="async"
      />
    );
  }

  // onLight: logo εντός σκούρου pill — ίδια εμπειρία με το sidebar, ορατό σε ανοιχτά φόντα
  const pill = Math.round(height * 0.28);
  const paddingX = Math.round(height * 0.28);
  const paddingY = Math.round(height * 0.14);

  return (
    <div
      className={`inline-flex shrink-0 items-center justify-start bg-[#111827] ${className}`}
      style={{
        borderRadius: pill,
        paddingLeft: paddingX,
        paddingRight: paddingX,
        paddingTop: paddingY,
        paddingBottom: paddingY,
      }}
    >
      <img
        src={lockupSrc}
        alt="Performance+ by notthesame.ai"
        className="block h-auto w-auto max-w-[min(100%,320px)] object-contain object-left"
        style={{ height }}
        loading="eager"
        decoding="async"
      />
    </div>
  );
}
