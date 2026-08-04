import buildInfoJson from '../../generated/buildInfo.json';
import type { BuildInfo } from '../../types/buildInfo';

// Cast so empty commits/changes arrays don't infer as never[] under `tsc -b`.
const buildInfo = buildInfoJson as BuildInfo;

/** `onLight`: Performance.png in a dark pill; `onDark`: Performance.png directly on a dark background.
 * Both variants use the official asset; there is no SVG/HTML proxy. */
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

  // onLight: logo inside a dark pill — same as the sidebar, visible on light backgrounds
  const pill = Math.round(height * 0.28);
  const paddingX = Math.round(height * 0.28);
  const paddingY = Math.round(height * 0.14);

  return (
    <div
      className={`inline-flex shrink-0 items-center justify-start bg-[var(--navy-500)] ${className}`}
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
