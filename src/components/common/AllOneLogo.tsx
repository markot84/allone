import buildInfoJson from '../../generated/buildInfo.json';
import type { BuildInfo } from '../../types/buildInfo';

// Cast so empty commits/changes arrays don't infer as never[] under `tsc -b`.
const buildInfo = buildInfoJson as BuildInfo;

/**
 * The allone lockup.
 *
 * The asset is a STACKED lockup — the mark above the wordmark — drawn in navy on white, and it is
 * the source colors.md was sampled from: navy wordmark, orange `o`, gold and sky pixels. That makes
 * the variants the inverse of what they were under the old logo, which was white on black:
 *
 *   `onLight` — straight onto the light chrome, no plate. The old logo needed a dark pill to be
 *               visible on white; this one would be hidden by it.
 *   `onDark`  — on a white plate, because navy on a dark gradient is unreadable.
 *
 * Nothing here crops the asset. A horizontal lockup would read better in a 30px header bar, but
 * assembling one out of the mark and the wordmark is a brand decision, not a layout one.
 */
export interface AllOneLogoProps {
  className?: string;
  height?: number;
  variant?: 'onDark' | 'onLight';
}

export function AllOneLogo({ className = '', height = 36, variant = 'onLight' }: AllOneLogoProps) {
  const v = encodeURIComponent(buildInfo.version);
  const lockupSrc = `/allone.png?v=${v}`;

  const image = (
    <img
      src={lockupSrc}
      alt="allone by notthesame.ai"
      className="block h-auto w-auto max-w-[min(100%,320px)] object-contain object-left"
      style={{ height }}
      loading="eager"
      decoding="async"
    />
  );

  if (variant === 'onLight') {
    return <span className={`inline-flex shrink-0 items-center ${className}`}>{image}</span>;
  }

  // onDark: a white plate, sized off the logo so it reads as a deliberate lockup rather than a
  // pasted rectangle.
  const radius = Math.round(height * 0.22);
  const padding = Math.round(height * 0.16);

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-start bg-white ${className}`}
      style={{ borderRadius: radius, padding }}
    >
      {image}
    </span>
  );
}
