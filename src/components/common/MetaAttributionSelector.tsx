import { useAttribution } from '../../contexts/AttributionContext';
import {
  META_ATTRIBUTION_WINDOWS,
  META_ATTRIBUTION_WINDOW_LABELS,
  type MetaAttributionWindow,
} from '../../types';

/**
 * Selector for the Meta attribution window (Meta campaigns only); used in Campaigns and ROI headers.
 *
 * `onChrome` is for the navy top bar: the label there has to be chrome-coloured, because the muted
 * grey it uses on white measures under 2:1 on navy and simply disappears.
 */
export function MetaAttributionSelector({ compact = false, onChrome = false }: { compact?: boolean; onChrome?: boolean }) {
  const { metaWindow, setMetaWindow } = useAttribution();

  const options: MetaAttributionWindow[] = ['default', ...META_ATTRIBUTION_WINDOWS];
  const title =
    'Meta Attribution Window\nΕπιλέγει ποιες conversions αποδίδονται στις Meta καμπάνιες ' +
    'ανάλογα με το παράθυρο click/view. «Default» = ρύθμιση του ad account.';

  return (
    <div className="flex items-center gap-2" title={title}>
      {!compact && (
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: onChrome ? 'var(--chrome-fg-muted)' : 'var(--text-muted)',
            whiteSpace: 'nowrap',
          }}
        >
          Meta Attribution
        </span>
      )}
      <select
        value={metaWindow}
        onChange={(e) => setMetaWindow(e.target.value as MetaAttributionWindow)}
        className="signal-btn text-xs rounded-lg px-2 py-1.5 min-h-[36px]"
        style={{
          border: `1px solid ${onChrome ? 'var(--chrome-control-border)' : 'var(--border)'}`,
          background: onChrome ? 'var(--chrome-control-bg)' : 'var(--surface-0)',
          color: onChrome ? 'var(--chrome-fg)' : 'var(--text-secondary)',
          fontFamily: "'JetBrains Mono', monospace",
        }}
        aria-label="Meta attribution window"
      >
        {options.map((w) => (
          <option key={w} value={w}>
            {META_ATTRIBUTION_WINDOW_LABELS[w]}
          </option>
        ))}
      </select>
    </div>
  );
}
