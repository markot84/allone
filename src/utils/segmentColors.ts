import { SEGMENT_COLOR_TOKENS, token } from '../styles/chartTheme';
import type { RFMSegment } from '../types';


/** The `--token` name for a segment, for callers that want `var(...)` rather than a literal. */
export function getSegmentColorToken(segment: RFMSegment | null | undefined): string {
  if (!segment) return '--seg-lost';
  const idKey = segment.id.toLowerCase().replace(/\s+/g, '_');
  const idKeyNoApostrophe = idKey.replace(/'/g, '');
  const nameKey = (segment.name ?? '').toLowerCase().replace(/\s+/g, '_');
  const nameKeyNoApostrophe = nameKey.replace(/'/g, '');
  return (
    SEGMENT_COLOR_TOKENS[segment.id] ??
    SEGMENT_COLOR_TOKENS[idKey] ??
    SEGMENT_COLOR_TOKENS[idKeyNoApostrophe] ??
    SEGMENT_COLOR_TOKENS[nameKey] ??
    SEGMENT_COLOR_TOKENS[nameKeyNoApostrophe] ??
    '--seg-lost'
  );
}

/**
 * The literal colour for a segment.
 *
 * Literal rather than `var(--x)` because this value is handed to Nivo and Recharts, which paint it
 * into SVG fills and their own colour maths — neither resolves a custom property. Any stored
 * `segment.color` is deliberately ignored: it is a hex frozen into Firestore by whichever importer
 * ran, and the palette is a display decision that should follow the tokens, not the data.
 */
export function getSegmentColor(segment: RFMSegment | null | undefined): string {
  return token(getSegmentColorToken(segment));
}
