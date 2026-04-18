import { useEffect, useMemo, useState } from 'react';
import type { Campaign } from '../../types';
import { Card, CardHeader, Tooltip } from '../common';
import { Search, Globe, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { buildGeoMekkoColumns, resolveCountryToIso2 } from './campaignGeoMapUtils';
import type { GeoChartMetric } from './campaignGeoMapUtils';
import { CampaignsGeoMekko } from './CampaignsGeoMekko';

type GeoMetrics = {
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  amount_spent: number;
  ctr: number;
  cpc: number;
  roas: number;
};

type CountryRow = GeoMetrics & { kind: 'country'; country: string };
type CityRow = GeoMetrics & { kind: 'city'; country: string; locality: string; key: string };

type GeoRow = CountryRow | CityRow;

type SortCol =
  | 'country'
  | 'locality'
  | 'impressions'
  | 'clicks'
  | 'conversions'
  | 'conversion_value'
  | 'amount_spent'
  | 'ctr'
  | 'cpc'
  | 'roas';

const fmtNum = (n: number) => n.toLocaleString('el-GR', { maximumFractionDigits: 0 });
const fmtMoney = (n: number) =>
  n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
/** CPC συχνά < 1 €· με maxFractionDigits 0 το fmtMoney έδειχνε λάθος «0 €». */
const fmtCpc = (n: number) =>
  n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fmtPct = (n: number) => `${n.toFixed(2)}%`;
const fmtRoas = (n: number) => `${n.toFixed(2)}x`;
const fmtConvGeo = (n: number) => {
  const intish = Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-6;
  return n.toLocaleString('el-GR', { maximumFractionDigits: intish ? 0 : 2 });
};

function formatCountryLabel(raw: string): string {
  const iso = resolveCountryToIso2(raw);
  if (iso) return iso;
  const t = (raw || '').trim();
  return t || '—';
}

/** Κλειδί `CC|Τοπωνύμιο` από connectors (Google/Meta). */
function parseCityKey(raw: string): { country: string; locality: string } {
  const key = raw || 'UNKNOWN';
  const pipe = key.indexOf('|');
  if (pipe <= 0) return { country: '??', locality: key };
  return {
    country: key.slice(0, pipe).trim() || '??',
    locality: key.slice(pipe + 1).trim() || '—',
  };
}

interface Props {
  campaigns: Campaign[];
}

/**
 * Αθροίζει geo.byCountry / geo.byCity από όλες τις ορατές καμπάνιες.
 */
export function CampaignsGeoTab({ campaigns }: Props) {
  const [level, setLevel] = useState<'country' | 'city'>('country');
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<SortCol>('amount_spent');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showAllRows, setShowAllRows] = useState(false);
  const [chartMetric, setChartMetric] = useState<GeoChartMetric>('amount_spent');

  useEffect(() => {
    setSortCol('amount_spent');
    setSortDir('desc');
  }, [level]);

  useEffect(() => {
    setShowAllRows(false);
  }, [level, campaigns]);

  const rows = useMemo<GeoRow[]>(() => {
    const acc = new Map<string, GeoRow>();

    if (level === 'country') {
      for (const c of campaigns) {
        const byCountry = c.geo?.byCountry;
        if (!byCountry) continue;
        for (const [country, m] of Object.entries(byCountry)) {
          const key = country || 'UNKNOWN';
          const cur = acc.get(key) as CountryRow | undefined;
          const base: CountryRow = cur || {
            kind: 'country',
            country: key,
            impressions: 0,
            clicks: 0,
            conversions: 0,
            conversion_value: 0,
            amount_spent: 0,
            ctr: 0,
            cpc: 0,
            roas: 0,
          };
          base.impressions += m.impressions || 0;
          base.clicks += m.clicks || 0;
          base.conversions += m.conversions || 0;
          base.conversion_value += m.conversion_value || 0;
          base.amount_spent += m.amount_spent || 0;
          acc.set(key, base);
        }
      }
    } else {
      for (const c of campaigns) {
        const byCity = c.geo?.byCity;
        if (!byCity) continue;
        const entries = Object.entries(byCity);
        const totalSpent = entries.reduce((s, [, m]) => s + (m.amount_spent || 0), 0);
        const totalRawConv = entries.reduce((s, [, m]) => s + (m.conversions || 0), 0);
        const totalRawVal = entries.reduce((s, [, m]) => s + (m.conversion_value || 0), 0);
        const campConv =
          (typeof c.purchase_conversions === 'number' ? c.purchase_conversions : null) ??
          c.conversions ??
          0;
        const campVal =
          (typeof c.purchase_conversion_value === 'number' ? c.purchase_conversion_value : null) ??
          c.conversion_value ??
          0;
        // Meta/ορισμένα APIs δεν δίνουν purchases ανά περιοχή (όλα 0) ενώ το campaign έχει σύνολα·
        // κατανομή κατά spend share μόνο όταν το raw geo είναι ουσιαστικά κενό σε conversions.
        const convSlack = Math.max(0, Number(campConv) - totalRawConv);
        const valSlack = Math.max(0, Number(campVal) - totalRawVal);
        const allocConv = convSlack > 0.01 && totalRawConv < 0.01 && totalSpent > 0;
        const allocVal = valSlack > 0.01 && totalRawVal < 0.01 && totalSpent > 0;

        for (const [locKey, m] of entries) {
          const { country, locality } = parseCityKey(locKey);
          const spend = m.amount_spent || 0;
          const share = totalSpent > 0 ? spend / totalSpent : 0;
          const conv = (m.conversions || 0) + (allocConv ? convSlack * share : 0);
          const cval = (m.conversion_value || 0) + (allocVal ? valSlack * share : 0);

          const cur = acc.get(locKey) as CityRow | undefined;
          const base: CityRow = cur || {
            kind: 'city',
            key: locKey,
            country,
            locality,
            impressions: 0,
            clicks: 0,
            conversions: 0,
            conversion_value: 0,
            amount_spent: 0,
            ctr: 0,
            cpc: 0,
            roas: 0,
          };
          base.impressions += m.impressions || 0;
          base.clicks += m.clicks || 0;
          base.conversions += conv;
          base.conversion_value += cval;
          base.amount_spent += spend;
          acc.set(locKey, base);
        }
      }
    }

    const list = Array.from(acc.values()).map((r) => {
      r.ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
      r.cpc = r.clicks > 0 ? r.amount_spent / r.clicks : 0;
      r.roas = r.amount_spent > 0 ? r.conversion_value / r.amount_spent : 0;
      return r;
    });

    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter((r) => {
          if (r.kind === 'country') {
            return r.country.toLowerCase().includes(q);
          }
          return (
            r.country.toLowerCase().includes(q) ||
            r.locality.toLowerCase().includes(q) ||
            `${r.country} ${r.locality}`.toLowerCase().includes(q)
          );
        })
      : list;

    const sorted = [...filtered].sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      if (sortCol === 'locality') {
        av = a.kind === 'city' ? a.locality : '';
        bv = b.kind === 'city' ? b.locality : '';
      } else if (sortCol === 'country') {
        av = a.country;
        bv = b.country;
      } else {
        av = a[sortCol] as number;
        bv = b[sortCol] as number;
      }
      let cmp = 0;
      if (typeof av === 'string' && typeof bv === 'string') {
        cmp = av.localeCompare(bv);
      } else {
        cmp = (av as number) - (bv as number);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }, [campaigns, search, sortCol, sortDir, level]);

  const mekkoColumns = useMemo(() => {
    const all = buildGeoMekkoColumns(campaigns, level, { metric: chartMetric });
    const q = search.trim();
    if (!q) return all;
    const keys = new Set(rows.map((r) => (r.kind === 'country' ? r.country : r.key)));
    return all.filter((c) => keys.has(c.id));
  }, [campaigns, chartMetric, level, search, rows]);

  const totals = useMemo(() => {
    return rows.reduce(
      (t, r) => {
        t.impressions += r.impressions;
        t.clicks += r.clicks;
        t.conversions += r.conversions;
        t.conversion_value += r.conversion_value;
        t.amount_spent += r.amount_spent;
        return t;
      },
      { impressions: 0, clicks: 0, conversions: 0, conversion_value: 0, amount_spent: 0 }
    );
  }, [rows]);

  const hasAnyCityData = useMemo(
    () => campaigns.some((c) => c.geo?.byCity && Object.keys(c.geo.byCity).length > 0),
    [campaigns]
  );

  const topImpressionKeys = useMemo(() => {
    const top = [...rows]
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 5);
    return new Set(top.map((r) => (r.kind === 'country' ? r.country : r.key)));
  }, [rows]);

  const hasSearch = search.trim().length > 0;
  const visibleRows = useMemo(() => {
    if (hasSearch || showAllRows || rows.length <= 5) return rows;
    return rows.filter((r) => topImpressionKeys.has(r.kind === 'country' ? r.country : r.key));
  }, [hasSearch, rows, showAllRows, topImpressionKeys]);
  const hiddenRowCount = Math.max(0, rows.length - visibleRows.length);

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortCol(col);
      setSortDir(col === 'country' || col === 'locality' ? 'asc' : 'desc');
    }
  };
  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <ArrowUpDown size={12} className="text-[#D1D5DB]" />;
    return sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  if (campaigns.length === 0) {
    return (
      <Card>
        <div className="py-10 text-center text-sm text-[#9CA3AF]">Δεν υπάρχουν καμπάνιες.</div>
      </Card>
    );
  }

  const emptyCountry =
    rows.length === 0 &&
    !search &&
    level === 'country' &&
    !campaigns.some((c) => c.geo?.byCountry && Object.keys(c.geo.byCountry).length > 0);

  const emptyCity =
    rows.length === 0 && !search && level === 'city' && !hasAnyCityData;

  if (emptyCountry) {
    return (
      <Card>
        <CardHeader
          title="Τοποθεσία"
          subtitle="Clicks, impressions, purchases & ROAS ανά χώρα."
          icon={<Globe size={18} className="text-[var(--nts-orange)]" />}
        />
        <div className="px-4 pb-6 text-center text-sm text-[#9CA3AF]">
          Δεν υπάρχουν δεδομένα ανά χώρα. Τρέξτε sync στο Google Ads / Meta.
        </div>
      </Card>
    );
  }

  const subtitle =
    level === 'country'
      ? `${rows.length} χώρες — σύνολο ${fmtMoney(totals.amount_spent)} spend, ${fmtConvGeo(totals.conversions)} αγορές.`
      : `${rows.length} τοποθεσίες — σύνολο ${fmtMoney(totals.amount_spent)} spend, ${fmtConvGeo(totals.conversions)} αγορές. Google: πόλη · Meta: περιοχή. Όπου το API δεν δίνει αγορές ανά γραμμή, εμφανίζεται εκτιμώμενη κατανομή κατά spend.`;

  return (
    <Card>
      <CardHeader
        title="Τοποθεσία"
        subtitle={subtitle}
        icon={<Globe size={18} className="text-[var(--nts-orange)]" />}
        action={
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <LevelToggle level={level} onChange={setLevel} hasCity={hasAnyCityData} />
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={level === 'country' ? 'Αναζήτηση χώρας' : 'Αναζήτηση χώρας ή πόλης'}
                className="pl-7 pr-2 py-1.5 text-xs border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[var(--nts-orange)]"
              />
            </div>
          </div>
        }
      />
      {emptyCity ? (
        <div className="px-4 pb-6 text-center text-sm text-[#9CA3AF]">
          Δεν υπάρχουν δεδομένα ανά πόλη/περιοχή ακόμα. Μετά το επόμενο sync (Google Ads / Meta) θα εμφανιστούν εδώ.
        </div>
      ) : (
      <>
      <CampaignsGeoMekko columns={mekkoColumns} level={level} metric={chartMetric} onMetricChange={setChartMetric} />
      <div className="overflow-x-auto max-h-[min(78vh,920px)] overflow-y-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-[#F9FAFB] z-10 text-xs text-[#6B7280] uppercase tracking-wider">
            <tr>
              <th
                className="px-3 py-2.5 font-medium cursor-pointer hover:text-[#111827]"
                onClick={() => toggleSort('country')}
              >
                <span className="inline-flex items-center gap-1">Χώρα <SortIcon col="country" /></span>
              </th>
              {level === 'city' && (
                <th
                  className="px-3 py-2.5 font-medium cursor-pointer hover:text-[#111827]"
                  onClick={() => toggleSort('locality')}
                >
                  <div className="inline-flex flex-col items-start gap-1 normal-case">
                    <span className="inline-flex items-center gap-1 uppercase tracking-wider text-xs">
                    Πόλη / Περιφέρεια
                    <Tooltip
                      content="Google Ads: city. Meta: region / περιφέρεια, όχι αξιόπιστο city-level."
                      size={11}
                    />
                    <SortIcon col="locality" />
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium tracking-normal normal-case text-[#6B7280]">
                      <span className="rounded bg-[#FFEDD5] px-1.5 py-0.5 text-[#F97316]">Google: city</span>
                      <span className="rounded bg-[#DBEAFE] px-1.5 py-0.5 text-[#3B82F6]">Meta: region</span>
                    </span>
                  </div>
                </th>
              )}
              <th
                className="px-3 py-2.5 font-medium text-right cursor-pointer hover:text-[#111827]"
                onClick={() => toggleSort('impressions')}
              >
                <span className="inline-flex items-center gap-1 justify-end w-full">Impr. <SortIcon col="impressions" /></span>
              </th>
              <th
                className="px-3 py-2.5 font-medium text-right cursor-pointer hover:text-[#111827]"
                onClick={() => toggleSort('clicks')}
              >
                <span className="inline-flex items-center gap-1 justify-end w-full">Clicks <SortIcon col="clicks" /></span>
              </th>
              <th
                className="px-3 py-2.5 font-medium text-right cursor-pointer hover:text-[#111827]"
                onClick={() => toggleSort('ctr')}
              >
                <span className="inline-flex items-center gap-1 justify-end w-full">CTR <SortIcon col="ctr" /></span>
              </th>
              <th
                className="px-3 py-2.5 font-medium text-right cursor-pointer hover:text-[#111827]"
                onClick={() => toggleSort('amount_spent')}
              >
                <span className="inline-flex items-center gap-1 justify-end w-full">Spend <SortIcon col="amount_spent" /></span>
              </th>
              <th
                className="px-3 py-2.5 font-medium text-right cursor-pointer hover:text-[#111827]"
                onClick={() => toggleSort('cpc')}
              >
                <span className="inline-flex items-center gap-1 justify-end w-full">CPC <SortIcon col="cpc" /></span>
              </th>
              <th
                className="px-3 py-2.5 font-medium text-right cursor-pointer hover:text-[#111827]"
                onClick={() => toggleSort('conversions')}
              >
                <span className="inline-flex items-center gap-1 justify-end w-full">
                  Αγορές
                  <Tooltip content="Purchases (Meta: pixel/purchase, Google: PURCHASE category)" size={11} />
                  <SortIcon col="conversions" />
                </span>
              </th>
              <th
                className="px-3 py-2.5 font-medium text-right cursor-pointer hover:text-[#111827]"
                onClick={() => toggleSort('conversion_value')}
              >
                <span className="inline-flex items-center gap-1 justify-end w-full">Έσοδα <SortIcon col="conversion_value" /></span>
              </th>
              <th
                className="px-3 py-2.5 font-medium text-right cursor-pointer hover:text-[#111827]"
                onClick={() => toggleSort('roas')}
              >
                <span className="inline-flex items-center gap-1 justify-end w-full">ROAS <SortIcon col="roas" /></span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F3F4F6]">
            {visibleRows.map((r) =>
              r.kind === 'country' ? (
                <tr key={r.country} className="hover:bg-[#FAFAFA] transition-colors">
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-2 text-sm text-[#111827] font-medium">
                      {formatCountryLabel(r.country)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[#111827]">{fmtNum(r.impressions)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[#111827]">{fmtNum(r.clicks)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[#6B7280]">{fmtPct(r.ctr)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[#111827]">{fmtMoney(r.amount_spent)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[#6B7280]">{fmtCpc(r.cpc)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[#111827]">{fmtConvGeo(r.conversions)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[#111827]">{fmtMoney(r.conversion_value)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    <span
                      className={`px-1.5 py-0.5 rounded-md ${
                        r.roas >= 3
                          ? 'bg-[#F0FDF4] text-[#22C55E]'
                          : r.roas >= 1
                            ? 'bg-[#FFFBEB] text-[#F59E0B]'
                            : 'bg-[#FEF2F2] text-[#EF4444]'
                      }`}
                    >
                      {fmtRoas(r.roas)}
                    </span>
                  </td>
                </tr>
              ) : (
                <tr key={r.key} className="hover:bg-[#FAFAFA] transition-colors">
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-2 text-sm text-[#111827] font-medium">
                      {formatCountryLabel(r.country)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-sm text-[#374151]">{r.locality}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[#111827]">{fmtNum(r.impressions)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[#111827]">{fmtNum(r.clicks)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[#6B7280]">{fmtPct(r.ctr)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[#111827]">{fmtMoney(r.amount_spent)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[#6B7280]">{fmtCpc(r.cpc)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[#111827]">{fmtConvGeo(r.conversions)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[#111827]">{fmtMoney(r.conversion_value)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    <span
                      className={`px-1.5 py-0.5 rounded-md ${
                        r.roas >= 3
                          ? 'bg-[#F0FDF4] text-[#22C55E]'
                          : r.roas >= 1
                            ? 'bg-[#FFFBEB] text-[#F59E0B]'
                            : 'bg-[#FEF2F2] text-[#EF4444]'
                      }`}
                    >
                      {fmtRoas(r.roas)}
                    </span>
                  </td>
                </tr>
              )
            )}
          </tbody>
          {rows.length > 1 && (
            <tfoot className="sticky bottom-0 bg-[#F9FAFB] border-t-2 border-[#E5E7EB]">
              <tr className="text-xs font-semibold text-[#374151]">
                <td className="px-3 py-2.5" colSpan={level === 'city' ? 2 : 1}>
                  Σύνολο ({rows.length})
                </td>
                <td className="px-3 py-2.5 text-right font-mono">{fmtNum(totals.impressions)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{fmtNum(totals.clicks)}</td>
                <td className="px-3 py-2.5 text-right font-mono">
                  {fmtPct(totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono">{fmtMoney(totals.amount_spent)}</td>
                <td className="px-3 py-2.5 text-right font-mono">
                  {fmtCpc(totals.clicks > 0 ? totals.amount_spent / totals.clicks : 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono">{fmtConvGeo(totals.conversions)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{fmtMoney(totals.conversion_value)}</td>
                <td className="px-3 py-2.5 text-right font-mono">
                  {fmtRoas(totals.amount_spent > 0 ? totals.conversion_value / totals.amount_spent : 0)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
        {!hasSearch && rows.length > 5 && (
          <div className="sticky bottom-0 flex justify-center border-t border-[#E5E7EB] bg-white/95 px-3 py-3 backdrop-blur">
            <button
              type="button"
              onClick={() => setShowAllRows((v) => !v)}
              className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-xs font-medium text-[#374151] transition-colors hover:bg-[#F9FAFB]"
            >
              {showAllRows
                ? 'Εμφάνιση μόνο top 5 βάσει impressions'
                : `Εμφάνιση ${hiddenRowCount} επιπλέον περιοχών`}
            </button>
          </div>
        )}
        {rows.length === 0 && search && (
          <p className="text-sm text-[#9CA3AF] text-center py-6">Δεν βρέθηκαν αποτελέσματα.</p>
        )}
      </div>
      </>
      )}
    </Card>
  );
}

function LevelToggle(props: {
  level: 'country' | 'city';
  onChange: (l: 'country' | 'city') => void;
  hasCity: boolean;
}) {
  const { level, onChange, hasCity } = props;
  return (
    <div className="inline-flex rounded-md border border-[#E5E7EB] overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => onChange('country')}
        className={`px-2.5 py-1.5 font-medium transition-colors ${
          level === 'country' ? 'bg-[var(--nts-orange)] text-white' : 'bg-white text-[#6B7280] hover:bg-[#F9FAFB]'
        }`}
      >
        Χώρα
      </button>
      <button
        type="button"
        onClick={() => onChange('city')}
        className={`px-2.5 py-1.5 font-medium transition-colors border-l border-[#E5E7EB] ${
          level === 'city' ? 'bg-[var(--nts-orange)] text-white' : 'bg-white text-[#6B7280] hover:bg-[#F9FAFB]'
        }`}
        title={!hasCity ? 'Θα εμφανιστεί μετά από sync με ενημερωμένους connectors' : undefined}
      >
        Πόλη
      </button>
    </div>
  );
}
