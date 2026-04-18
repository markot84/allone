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
          ? 'Διάγραμμα spend ανά χώρα και κανάλι'
          : 'Διάγραμμα spend ανά τοποθεσία και κανάλι'
      }
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h3 className="text-xs font-semibold text-[#111827] uppercase tracking-wide">
            Spend ανά {level === 'country' ? 'χώρα' : 'τοποθεσία'} vs κανάλι
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
          const widthPct = grandTotal > 0 ? (col.totalSpend / grandTotal) * 100 : 0;
          const showLabel = widthPct >= 8;
          const showDetail = widthPct >= 14;
          const channelBadges = [...activeSegs].sort((a, b) => b.spend - a.spend);
          return (
            <div
              key={col.id}
              className="relative flex flex-col min-w-0 h-full overflow-hidden"
              style={{ flex: `${col.totalSpend} 1 0%`, minWidth: 2 }}
              title={`${labelTitle} — ${fmtMoney(col.totalSpend)} (${widthPct.toFixed(1)}% του συνόλου)`}
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

              {showLabel && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 p-1.5">
                  <div className="rounded bg-black/35 px-1.5 py-1 text-white shadow-sm backdrop-blur-[1px]">
                    <span className="block truncate text-[10px] font-medium leading-tight">{col.label}</span>
                    {col.subtitle && (
                      <span className="block truncate text-[9px] leading-tight text-white/80">{col.subtitle}</span>
                    )}
                    {showDetail && (
                      <>
                        <span className="mt-0.5 block truncate text-[9px] leading-tight text-white/90">
                          {fmtMoney(col.totalSpend)} · {widthPct.toFixed(1)}%
                        </span>
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {channelBadges.map((seg) => (
                            <span
                              key={seg.channel}
                              className="inline-flex max-w-full items-center gap-1 rounded bg-white/15 px-1 py-0.5 text-[9px] leading-none text-white/95"
                            >
                              <span
                                className="inline-block size-1.5 rounded-full shrink-0"
                                style={{ backgroundColor: CHANNEL_FILL[seg.channel] }}
                              />
                              <span className="truncate">
                                {CHANNEL_LABEL[seg.channel]} {((seg.spend / col.totalSpend) * 100).toFixed(0)}%
                              </span>
                            </span>
                          ))}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}
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
