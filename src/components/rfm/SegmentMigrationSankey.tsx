import { useMemo } from 'react';
import { ResponsiveSankey } from '@nivo/sankey';
import { formatNumber } from '../../utils/format';
import { readTokenColor } from '../../utils/cssToken';
import { useRevealOnce } from '../../hooks/useRevealOnce';
import type { SegmentMigrationFlow } from '../../services/rfmFromOrders';

/**
 * Where customers actually went, as a flow diagram.
 *
 * The data is real, not modelled: `computeSegmentMigrationFromEcommerceOrders` re-derives every
 * customer's segment at two points in time from the order history and diffs the assignments, so a
 * ribbon here is a count of people who genuinely crossed from one segment to another.
 *
 * The two periods are separate node sets (`prev:` / `curr:`) even though they name the same five
 * segments. Sankey links must form a DAG, and Champions → At Risk together with At Risk →
 * Champions — both perfectly normal in one window — would be a cycle on shared nodes. Splitting
 * them also makes the picture honest: the left column is who they were, the right is who they are.
 */

interface SegmentMigrationSankeyProps {
  flows: SegmentMigrationFlow[];
  /** Segment id → the colour that segment carries everywhere else on the page. */
  colorById: Map<string, string>;
  /** Identity for the once-per-session reveal — include the brand so a brand switch redraws. */
  revealKey: string;
}

const PREV = 'prev:';
const CURR = 'curr:';

export function SegmentMigrationSankey({ flows, colorById, revealKey }: SegmentMigrationSankeyProps) {
  const fallback = readTokenColor('--text-muted', 'var(--text-muted)');
  const { ref, mounted, animate } = useRevealOnce(revealKey);

  const data = useMemo(() => {
    const nodes = new Map<string, { id: string; label: string; nodeColor: string }>();
    const add = (prefix: string, id: string, name: string, suffix: string) => {
      const key = `${prefix}${id}`;
      if (!nodes.has(key)) {
        nodes.set(key, { id: key, label: `${name} ${suffix}`, nodeColor: colorById.get(id) ?? fallback });
      }
    };
    const links = flows.map((flow) => {
      add(PREV, flow.from, flow.fromName, '(πριν)');
      add(CURR, flow.to, flow.toName, '(τώρα)');
      return { source: `${PREV}${flow.from}`, target: `${CURR}${flow.to}`, value: flow.count };
    });
    return { nodes: [...nodes.values()], links };
  }, [colorById, fallback, flows]);

  const labelColor = readTokenColor('--text-secondary', 'var(--text-secondary)');

  if (data.links.length === 0) return null;

  // The height is reserved whether or not the chart has been revealed yet, so the card never
  // reflows under the reader when it scrolls in.
  const height = Math.max(220, Math.min(420, data.links.length * 44));

  if (!mounted) return <div ref={ref} style={{ height }} aria-hidden />;

  return (
    <div ref={ref} style={{ height }}>
      <ResponsiveSankey
        data={data}
        margin={{ top: 8, right: 130, bottom: 8, left: 130 }}
        align="justify"
        colors={(node: { nodeColor?: string }) => node.nodeColor ?? fallback}
        nodeOpacity={1}
        nodeHoverOthersOpacity={0.3}
        nodeThickness={14}
        nodeSpacing={16}
        nodeBorderWidth={0}
        nodeBorderRadius={3}
        linkOpacity={0.4}
        linkHoverOthersOpacity={0.1}
        linkContract={2}
        enableLinkGradient
        labelPosition="outside"
        labelOrientation="horizontal"
        labelPadding={12}
        label={(node: { label?: string; id: string | number }) => node.label ?? String(node.id)}
        labelTextColor={labelColor}
        animate={animate}
        motionConfig="gentle"
        nodeTooltip={({ node }: { node: { label?: string; id: string | number; value: number } }) => (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-xs shadow-lg">
            <p className="font-semibold text-[var(--text-primary)]">{node.label ?? node.id}</p>
            <p className="mt-0.5 font-mono text-[var(--text-secondary)]" data-numeric>
              {formatNumber(node.value)} πελάτες
            </p>
          </div>
        )}
        linkTooltip={({ link }: { link: { source: { label?: string }; target: { label?: string }; value: number } }) => (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-xs shadow-lg">
            <p className="font-semibold text-[var(--text-primary)]">
              {link.source.label} → {link.target.label}
            </p>
            <p className="mt-0.5 font-mono text-[var(--text-secondary)]" data-numeric>
              {formatNumber(link.value)} πελάτες
            </p>
          </div>
        )}
        theme={{
          text: { fontFamily: 'Inter, sans-serif', fontSize: 11, fill: labelColor },
        }}
      />
    </div>
  );
}
