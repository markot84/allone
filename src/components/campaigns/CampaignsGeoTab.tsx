import { useMemo, useState } from 'react';
import type { Campaign } from '../../types';
import { Card, CardHeader, Tooltip } from '../common';
import { Search, Globe, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

type GeoRow = {
  country: string;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  amount_spent: number;
  ctr: number;
  cpc: number;
  roas: number;
};

type SortCol = keyof Pick<
  GeoRow,
  'country' | 'impressions' | 'clicks' | 'conversions' | 'conversion_value' | 'amount_spent' | 'ctr' | 'cpc' | 'roas'
>;

const fmtNum = (n: number) => n.toLocaleString('el-GR', { maximumFractionDigits: 0 });
const fmtMoney = (n: number) =>
  n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(2)}%`;
const fmtRoas = (n: number) => `${n.toFixed(2)}x`;

// ISO-2 → flag emoji (regional indicator symbols).
function flag(code: string): string {
  const c = (code || '').trim().toUpperCase();
  if (c.length !== 2 || !/^[A-Z]{2}$/.test(c)) return '🌐';
  return String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0)));
}

interface Props {
  campaigns: Campaign[];
}

/**
 * Αθροίζει geo.byCountry από ΟΛΕΣ τις ορατές καμπάνιες και εμφανίζει πίνακα
 * impressions/clicks/purchases/spend/ROAS ανά χώρα.
 *
 * Σημείωση: τα geo data είναι lifetime (δεν φιλτράρονται ανά dateFrom/To)·
 * αυτό συμφωνεί με το πώς τα επιστρέφει το Google Ads `geographic_view` &
 * το Meta breakdowns=country (χωρίς time_increment ανά χώρα).
 */
export function CampaignsGeoTab({ campaigns }: Props) {
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<SortCol>('amount_spent');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const rows = useMemo<GeoRow[]>(() => {
    const acc = new Map<string, GeoRow>();
    for (const c of campaigns) {
      const byCountry = c.geo?.byCountry;
      if (!byCountry) continue;
      for (const [country, m] of Object.entries(byCountry)) {
        const key = country || 'UNKNOWN';
        const cur = acc.get(key) || {
          country: key,
          impressions: 0, clicks: 0, conversions: 0,
          conversion_value: 0, amount_spent: 0,
          ctr: 0, cpc: 0, roas: 0,
        };
        cur.impressions += m.impressions || 0;
        cur.clicks += m.clicks || 0;
        cur.conversions += m.conversions || 0;
        cur.conversion_value += m.conversion_value || 0;
        cur.amount_spent += m.amount_spent || 0;
        acc.set(key, cur);
      }
    }
    const list = Array.from(acc.values()).map((r) => {
      r.ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
      r.cpc = r.clicks > 0 ? r.amount_spent / r.clicks : 0;
      r.roas = r.amount_spent > 0 ? r.conversion_value / r.amount_spent : 0;
      return r;
    });

    const filtered = search.trim()
      ? list.filter((r) => r.country.toLowerCase().includes(search.toLowerCase()))
      : list;

    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      let cmp = 0;
      if (typeof av === 'string' && typeof bv === 'string') {
        cmp = av.localeCompare(bv);
      } else {
        cmp = (av as number) - (bv as number);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }, [campaigns, search, sortCol, sortDir]);

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

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortCol(col);
      setSortDir(col === 'country' ? 'asc' : 'desc');
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

  if (rows.length === 0 && !search) {
    return (
      <Card>
        <CardHeader
          title="Γεωγραφική κατανομή"
          subtitle="Clicks, impressions, purchases & ROAS ανά χώρα."
          icon={<Globe size={18} className="text-[var(--nts-orange)]" />}
        />
        <div className="px-4 pb-6 text-center text-sm text-[#9CA3AF]">
          Δεν υπάρχουν γεωγραφικά δεδομένα. Τρέξτε sync στο Google Ads / Meta για να φορτωθούν breakdowns ανά χώρα.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Γεωγραφική κατανομή"
        subtitle={`${rows.length} χώρες — σύνολο ${fmtMoney(totals.amount_spent)} spend, ${fmtNum(totals.conversions)} αγορές.`}
        icon={<Globe size={18} className="text-[var(--nts-orange)]" />}
        action={
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Αναζήτηση χώρας"
              className="pl-7 pr-2 py-1.5 text-xs border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[var(--nts-orange)]"
            />
          </div>
        }
      />
      <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-[#F9FAFB] z-10 text-xs text-[#6B7280] uppercase tracking-wider">
            <tr>
              <th
                className="px-3 py-2.5 font-medium cursor-pointer hover:text-[#111827]"
                onClick={() => toggleSort('country')}
              >
                <span className="inline-flex items-center gap-1">Χώρα <SortIcon col="country" /></span>
              </th>
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
            {rows.map((r) => (
              <tr key={r.country} className="hover:bg-[#FAFAFA] transition-colors">
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-2 text-sm text-[#111827] font-medium">
                    <span aria-hidden className="text-base leading-none">{flag(r.country)}</span>
                    {r.country}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[#111827]">{fmtNum(r.impressions)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-[#111827]">{fmtNum(r.clicks)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-[#6B7280]">{fmtPct(r.ctr)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-[#111827]">{fmtMoney(r.amount_spent)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-[#6B7280]">{fmtMoney(r.cpc)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-[#111827]">{fmtNum(r.conversions)}</td>
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
            ))}
          </tbody>
          {rows.length > 1 && (
            <tfoot className="sticky bottom-0 bg-[#F9FAFB] border-t-2 border-[#E5E7EB]">
              <tr className="text-xs font-semibold text-[#374151]">
                <td className="px-3 py-2.5">Σύνολο ({rows.length})</td>
                <td className="px-3 py-2.5 text-right font-mono">{fmtNum(totals.impressions)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{fmtNum(totals.clicks)}</td>
                <td className="px-3 py-2.5 text-right font-mono">
                  {fmtPct(totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono">{fmtMoney(totals.amount_spent)}</td>
                <td className="px-3 py-2.5 text-right font-mono">
                  {fmtMoney(totals.clicks > 0 ? totals.amount_spent / totals.clicks : 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono">{fmtNum(totals.conversions)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{fmtMoney(totals.conversion_value)}</td>
                <td className="px-3 py-2.5 text-right font-mono">
                  {fmtRoas(totals.amount_spent > 0 ? totals.conversion_value / totals.amount_spent : 0)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
        {rows.length === 0 && search && (
          <p className="text-sm text-[#9CA3AF] text-center py-6">Δεν βρέθηκαν αποτελέσματα.</p>
        )}
      </div>
    </Card>
  );
}
