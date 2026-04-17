import { memo, useCallback, useMemo, useState } from 'react';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { scaleLinear } from 'd3-scale';
import { type CountryAgg, normalizeGeoName, resolveCountryToIso2 } from './campaignGeoMapUtils';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

export type MapMetric = 'amount_spent' | 'conversion_value' | 'conversions' | 'impressions';

type TipState = {
  x: number;
  y: number;
  title: string;
  lines: string[];
} | null;

const METRIC_OPTIONS: { id: MapMetric; label: string }[] = [
  { id: 'amount_spent', label: 'Spend' },
  { id: 'conversion_value', label: 'Έσοδα' },
  { id: 'conversions', label: 'Αγορές' },
  { id: 'impressions', label: 'Impr.' },
];

function fmtMoney(n: number) {
  return n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function fmtNum(n: number) {
  return n.toLocaleString('el-GR', { maximumFractionDigits: 0 });
}

function useCountryDataMaps(rows: CountryAgg[]) {
  return useMemo(() => {
    const byIso = new Map<string, CountryAgg>();
    const byName = new Map<string, CountryAgg>();

    for (const row of rows) {
      const iso = resolveCountryToIso2(row.country);
      if (iso) {
        const prev = byIso.get(iso);
        if (!prev) byIso.set(iso, { ...row });
        else {
          byIso.set(iso, {
            country: iso,
            impressions: prev.impressions + row.impressions,
            clicks: prev.clicks + row.clicks,
            conversions: prev.conversions + row.conversions,
            conversion_value: prev.conversion_value + row.conversion_value,
            amount_spent: prev.amount_spent + row.amount_spent,
          });
        }
        continue;
      }
      const nk = normalizeGeoName(row.country);
      if (!nk) continue;
      const prev = byName.get(nk);
      if (!prev) byName.set(nk, { ...row });
      else {
        byName.set(nk, {
          country: row.country,
          impressions: prev.impressions + row.impressions,
          clicks: prev.clicks + row.clicks,
          conversions: prev.conversions + row.conversions,
          conversion_value: prev.conversion_value + row.conversion_value,
          amount_spent: prev.amount_spent + row.amount_spent,
        });
      }
    }

    return { byIso, byName };
  }, [rows]);
}

function pickMetric(row: CountryAgg | undefined, m: MapMetric): number {
  if (!row) return 0;
  const v = row[m];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function rowForGeo(
  props: { ISO_A2?: string; NAME?: string; NAME_LONG?: string },
  byIso: Map<string, CountryAgg>,
  byName: Map<string, CountryAgg>
): CountryAgg | undefined {
  const isoRaw = props.ISO_A2;
  if (isoRaw && isoRaw.length === 2 && isoRaw !== '-99') {
    const hit = byIso.get(isoRaw.toUpperCase());
    if (hit) return hit;
  }
  for (const name of [props.NAME_LONG, props.NAME]) {
    if (!name) continue;
    const hit = byName.get(normalizeGeoName(name));
    if (hit) return hit;
  }
  return undefined;
}

type GeographyShape = {
  rsmKey: string;
  properties: { ISO_A2?: string; NAME?: string; NAME_LONG?: string };
};

function CampaignsGeoChoroplethInner({ countryRows }: { countryRows: CountryAgg[] }) {
  const [metric, setMetric] = useState<MapMetric>('amount_spent');
  const [tip, setTip] = useState<TipState>(null);
  const { byIso, byName } = useCountryDataMaps(countryRows);

  const { maxVal, colorScale } = useMemo(() => {
    let max = 0;
    for (const r of countryRows) {
      const v = pickMetric(r, metric);
      if (v > max) max = v;
    }
    if (max <= 0) max = 1;
    const scale = scaleLinear<string>()
      .domain([0, max])
      .range(['#EEF2F7', '#0969da']);
    return { maxVal: max, colorScale: scale };
  }, [countryRows, metric]);

  const fillFor = useCallback(
    (geo: GeographyShape) => {
      const row = rowForGeo(geo.properties, byIso, byName);
      const v = pickMetric(row, metric);
      if (v <= 0) return '#F3F4F6';
      return colorScale(v);
    },
    [byIso, byName, colorScale, metric]
  );

  const onMove = useCallback(
    (geo: GeographyShape, e: React.MouseEvent) => {
      const wrap = (e.currentTarget as HTMLElement | null)?.closest?.('.geo-map-wrap') as HTMLElement | null;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const row = rowForGeo(geo.properties, byIso, byName);
      const v = pickMetric(row, metric);
      const name =
        geo.properties.NAME_LONG || geo.properties.NAME || geo.properties.ISO_A2 || '—';
      const lines: string[] = [];
      if (row && v > 0) {
        if (metric === 'amount_spent') lines.push(`Spend: ${fmtMoney(row.amount_spent)}`);
        else if (metric === 'conversion_value') lines.push(`Έσοδα: ${fmtMoney(row.conversion_value)}`);
        else if (metric === 'conversions') lines.push(`Αγορές: ${fmtNum(row.conversions)}`);
        else lines.push(`Impr.: ${fmtNum(row.impressions)}`);
        lines.push(`ROAS: ${row.amount_spent > 0 ? (row.conversion_value / row.amount_spent).toFixed(2) : '—'}x`);
      } else {
        lines.push('Δεν υπάρχουν δεδομένα καμπανιών');
      }
      setTip({
        x: e.clientX - rect.left + 12,
        y: e.clientY - rect.top + 12,
        title: name,
        lines,
      });
    },
    [byIso, byName, metric]
  );

  return (
    <div className="mx-4 mb-4 rounded-xl border border-[#E5E7EB] bg-gradient-to-b from-[#FAFBFC] to-white overflow-hidden shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EEF2F7] px-3 py-2">
        <div>
          <p className="text-xs font-semibold text-[#111827]">Χάρτης επιδόσεων</p>
          <p className="text-[10px] text-[#6B7280]">Ζουμ/μετακίνηση με scroll ή σύρσιμο · σκούρο = υψηλότερη τιμή</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {METRIC_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setMetric(opt.id)}
              className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                metric === opt.id
                  ? 'bg-[var(--nts-orange)] text-white'
                  : 'bg-white text-[#6B7280] border border-[#E5E7EB] hover:bg-[#F9FAFB]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="geo-map-wrap relative w-full touch-pan-y"
        onMouseLeave={() => setTip(null)}
        style={{ minHeight: 280 }}
      >
        {tip && (
          <div
            className="pointer-events-none absolute z-30 max-w-[220px] rounded-lg border border-[#374151] bg-[#111827] px-2.5 py-2 text-[11px] text-white shadow-xl"
            style={{ left: Math.min(tip.x, 400), top: tip.y }}
          >
            <div className="font-semibold text-white/95">{tip.title}</div>
            {tip.lines.map((line, i) => (
              <div key={i} className="text-[#E5E7EB]">
                {line}
              </div>
            ))}
          </div>
        )}

        <ComposableMap
          projection="geoMercator"
          projectionConfig={{
            scale: 140,
            center: [15, 28],
          }}
          width={900}
          height={440}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        >
          <ZoomableGroup zoom={1} minZoom={0.6} maxZoom={8}>
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map((geo: GeographyShape) => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fillFor(geo)}
                    stroke="#D1D5DB"
                    strokeWidth={0.35}
                    style={{
                      default: { outline: 'none' },
                      hover: {
                        outline: 'none',
                        fill: fillFor(geo),
                        filter: 'brightness(0.92)',
                      },
                      pressed: { outline: 'none' },
                    }}
                    onMouseEnter={(e) => onMove(geo, e)}
                    onMouseMove={(e) => onMove(geo, e)}
                  />
                ))
              }
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>

        <div className="flex items-center justify-between gap-3 border-t border-[#EEF2F7] px-3 py-2">
          <span className="text-[10px] text-[#6B7280]">Κλίμακα ({METRIC_OPTIONS.find((m) => m.id === metric)?.label})</span>
          <div className="flex flex-1 items-center gap-2 max-w-md">
            <span className="text-[10px] font-mono text-[#9CA3AF]">0</span>
            <div
              className="h-2 flex-1 rounded-full"
              style={{
                background: 'linear-gradient(90deg, #EEF2F7 0%, #0969da 100%)',
              }}
            />
            <span className="text-[10px] font-mono text-[#374151]">
              {metric === 'amount_spent' || metric === 'conversion_value'
                ? fmtMoney(maxVal)
                : fmtNum(maxVal)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export const CampaignsGeoChoropleth = memo(CampaignsGeoChoroplethInner);
