import { useMemo, useState } from 'react';
import type { GeoMekkoChannel, GeoMekkoColumn } from './campaignGeoMapUtils';
import { Tooltip } from '../common';

const fmtMoney = (n: number) =>
  n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

const CHANNEL_FILL: Record<GeoMekkoChannel, string> = {
  'Google Ads': '#2E7D32',
  Meta: '#1565C0',
  Other: '#757575',
};

const CHANNEL_LABEL: Record<GeoMekkoChannel, string> = {
  'Google Ads': 'Google Ads',
  Meta: 'Meta',
  Other: 'Άλλο',
};

interface Props {
  columns: GeoMekkoColumn[];
  level: 'country' | 'city';
}

/**
 * Marimekko (Mekko): πλάτος στήλης ανάλογο με συνολικό spend περιοχής,
 * ύψος στοίβας = κατανομή spend ανά κανάλι εντός της περιοχής.
 */
export function CampaignsGeoMekko({ columns, level }: Props) {
  const [hover, setHover] = useState<{
    colId: string;
    channel: GeoMekkoChannel;
    spend: number;
    colLabel: string;
  } | null>(null);

  const grandTotal = useMemo(
    () => columns.reduce((s, c) => s + c.totalSpend, 0),
    [columns],
  );

  const channelsInUse = useMemo(() => {
    const set = new Set<GeoMekkoChannel>();
    for (const c of columns) {
      for (const seg of c.segments) {
        if (seg.spend > 0) set.add(seg.channel);
      }
    }
    return (['Google Ads', 'Meta', 'Other'] as const).filter((ch) => set.has(ch));
  }, [columns]);

  if (columns.length === 0 || grandTotal <= 0) return null;

  return (
    <div
      className="px-4 pb-4 border-b border-[#E5E7EB]"
      role="img"
      aria-label={
        level === 'country'
          ? 'Διάγραμμα Mekko: spend ανά χώρα και κανάλι'
          : 'Διάγραμμα Mekko: spend ανά τοποθεσία και κανάλι'
      }
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h3 className="text-xs font-semibold text-[#111827] uppercase tracking-wide">
            Spend ανά {level === 'country' ? 'χώρα' : 'τοποθεσία'} vs κανάλι (Mekko)
          </h3>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            Πλάτος στήλης ∝ spend περιοχής · ύψος ∝ κατανομή καναλιού εντός περιοχής. Top{' '}
            {columns.length} περιοχές.
          </p>
        </div>
        <Tooltip
          content="Το ίδιο spend με τον πίνακα (άθροισμα geo ανά καμπάνια). Κανάλι = καμπάνια Google / Meta / Άλλο."
          size={11}
        />
      </div>

      <div className="flex h-[220px] w-full gap-px rounded-md overflow-hidden bg-[#E5E7EB] border border-[#E5E7EB]">
        {columns.map((col) => {
          const activeSegs = col.segments.filter((s) => s.spend > 0);
          const labelTitle = col.subtitle ? `${col.label} (${col.subtitle})` : col.label;
          return (
            <div
              key={col.id}
              className="flex flex-col min-w-0 h-full"
              style={{ flex: `${col.totalSpend} 1 0%`, minWidth: 2 }}
            >
              <div className="flex flex-1 min-h-0 flex-col">
                {activeSegs.map((seg) => (
                  <div
                    key={seg.channel}
                    role="presentation"
                    className="w-full min-h-[2px] shrink"
                    style={{
                      flexGrow: seg.spend,
                      flexBasis: 0,
                      backgroundColor: CHANNEL_FILL[seg.channel],
                    }}
                    title={`${CHANNEL_LABEL[seg.channel]}: ${fmtMoney(seg.spend)} (${((seg.spend / col.totalSpend) * 100).toFixed(1)}% της στήλης)`}
                    onMouseEnter={() =>
                      setHover({
                        colId: col.id,
                        channel: seg.channel,
                        spend: seg.spend,
                        colLabel: col.subtitle ? `${col.label} (${col.subtitle})` : col.label,
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                  />
                ))}
              </div>
              <div
                className="shrink-0 pt-1 px-0.5 text-[9px] text-[#6B7280] leading-tight text-center truncate bg-[#F9FAFB]"
                title={labelTitle}
              >
                {col.subtitle ? (
                  <>
                    <span className="block truncate">{col.label}</span>
                    <span className="block truncate text-[#9CA3AF]">{col.subtitle}</span>
                  </>
                ) : (
                  <span className="block truncate">{col.label}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center text-[10px] text-[#4B5563]">
        {channelsInUse.map((ch) => (
          <span key={ch} className="inline-flex items-center gap-1">
            <span
              className="inline-block size-2 rounded-sm shrink-0"
              style={{ backgroundColor: CHANNEL_FILL[ch] }}
            />
            {CHANNEL_LABEL[ch]}
          </span>
        ))}
      </div>

      {hover && (
        <div className="mt-2 text-center text-xs text-[#374151]" aria-live="polite">
          <span className="font-medium">{hover.colLabel}</span>
          {' — '}
          <span style={{ color: CHANNEL_FILL[hover.channel] }}>{CHANNEL_LABEL[hover.channel]}</span>
          : {fmtMoney(hover.spend)}
        </div>
      )}
    </div>
  );
}
