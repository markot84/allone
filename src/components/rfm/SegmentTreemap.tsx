import { useMemo } from 'react';
import { ResponsiveTreeMap } from '@nivo/treemap';
import { formatNumber, formatPercent } from '../../utils/format';
import { mixWithWhite, readableTextOn } from '../../utils/color';
import { readTokenColor } from '../../utils/cssToken';
import type { RFMSegment } from '../../types';

/**
 * RFM segments as one figure instead of two donuts.
 *
 * Area is the number of customers, fill intensity is the segment's share of revenue. That pairing
 * is the whole point: a wide, pale tile is a crowd that does not pay, a small saturated one is a
 * handful of customers carrying the business. Reading that off two separate pie charts means
 * holding one in your head while you look at the other.
 *
 * Intensity is expressed by mixing each segment's OWN colour toward white rather than by putting
 * every tile on a single hue ramp. The segment colours identify the same five segments everywhere
 * else on the page — legend, detail panel, migration — and breaking that link for one chart would
 * cost more than the cleaner ramp gains.
 */

interface SegmentTreemapProps {
  segments: RFMSegment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** False on a revisit — the tiles appear already laid out instead of growing again. */
  animate: boolean;
}

type TileDatum = {
  id: string;
  name: string;
  value: number;
  share: number;
  fill: string;
  label: string;
};

export function SegmentTreemap({ segments, selectedId, onSelect, animate }: SegmentTreemapProps) {
  const { data, tiles } = useMemo(() => {
    const peakShare = Math.max(...segments.map((s) => s.revenue_share ?? 0), 0);
    const children: TileDatum[] = segments
      .filter((segment) => (segment.count ?? 0) > 0)
      .map((segment) => {
        const share = segment.revenue_share ?? 0;
        // Normalised against the strongest segment, so the range is actually used whatever the
        // absolute shares are. Floored well short of white: a 0%-revenue tile still has to be a
        // visible, identifiable colour.
        const intensity = peakShare > 0 ? share / peakShare : 0;
        return {
          id: segment.id,
          name: segment.name,
          value: segment.count ?? 0,
          share,
          fill: mixWithWhite(segment.color, 0.72 * (1 - intensity)),
          label: `${segment.name} · ${formatNumber(segment.count ?? 0)}`,
        };
      });
    return {
      data: { id: 'segments', name: 'segments', children },
      tiles: new Map(children.map((child) => [child.id, child])),
    };
  }, [segments]);

  const border = readTokenColor('--surface-0', 'var(--surface-0)');
  const selectedBorder = readTokenColor('--text-heading', '#204892');

  if (data.children.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-[var(--text-muted)]">
        Δεν υπάρχουν segments με πελάτες για εμφάνιση.
      </p>
    );
  }

  return (
    <div style={{ height: 320 }}>
      <ResponsiveTreeMap
        data={data}
        identity="id"
        value="value"
        valueFormat=">-,"
        label={(node) => tiles.get(node.id)?.label ?? node.id}
        labelSkipSize={44}
        tile="squarify"
        leavesOnly
        innerPadding={3}
        outerPadding={0}
        margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        colors={(node) => tiles.get(node.id)?.fill ?? 'var(--border)'}
        nodeOpacity={1}
        // Selection is a navy edge on an otherwise white gutter. The width is fixed because nivo's
        // treemap only takes a number here — the colour carries the state instead.
        borderWidth={2}
        borderColor={(node: { id: string | number }) => (node.id === selectedId ? selectedBorder : border)}
        labelTextColor={(node: { id: string | number }) => readableTextOn(tiles.get(String(node.id))?.fill ?? 'var(--surface-0)')}
        enableParentLabel={false}
        animate={animate}
        motionConfig="gentle"
        onClick={(node) => onSelect(String(node.id))}
        tooltip={({ node }) => {
          const tile = tiles.get(node.id);
          if (!tile) return null;
          return (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-xs shadow-lg">
              <p className="font-semibold text-[var(--text-primary)]">{tile.name}</p>
              <p className="mt-0.5 font-mono text-[var(--text-secondary)]" data-numeric>
                {formatNumber(tile.value)} πελάτες · {formatPercent(tile.share, 1)} τζίρου
              </p>
            </div>
          );
        }}
        theme={{
          text: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500 },
          labels: { text: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600 } },
        }}
      />
    </div>
  );
}
