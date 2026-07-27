import { useAttribution } from '../../contexts/AttributionContext';
import {
  META_ATTRIBUTION_WINDOWS,
  META_ATTRIBUTION_WINDOW_LABELS,
  type MetaAttributionWindow,
} from '../../types';

/** Selector for the Meta attribution window (Meta campaigns only); used in Campaigns and ROI headers. */
export function MetaAttributionSelector({ compact = false }: { compact?: boolean }) {
  const { metaWindow, setMetaWindow } = useAttribution();

  const options: MetaAttributionWindow[] = ['default', ...META_ATTRIBUTION_WINDOWS];
  const title =
    'Meta Attribution Window\nΕπιλέγει ποιες conversions αποδίδονται στις Meta καμπάνιες ' +
    'ανάλογα με το παράθυρο click/view. «Default» = ρύθμιση του ad account.';

  return (
    <div className="flex items-center gap-2" title={title}>
      {!compact && (
        <span className="text-[11px] font-medium text-[var(--nts-medium-gray)] uppercase tracking-wide">
          Meta Attribution
        </span>
      )}
      <select
        value={metaWindow}
        onChange={(e) => setMetaWindow(e.target.value as MetaAttributionWindow)}
        className="text-xs border border-[#E5E5E5] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)]/30 hover:border-[var(--nts-accent)]/50 transition-colors min-h-[36px]"
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
