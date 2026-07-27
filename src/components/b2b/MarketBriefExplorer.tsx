import { useMemo, useState } from 'react';
import countries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json';
import { Sparkles, Trash2, Columns3 } from 'lucide-react';
import { Button, Card, Spinner, useToast } from '../common';
import { useBrand } from '../../hooks/useBrand';
import { useProductSource } from '../../hooks/useProductSource';
import { useSuppliers } from '../../hooks/useSuppliers';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useMarketBriefs } from '../../hooks/useMarketBriefs';
import { coerceToDate } from '../../utils/coerceDate';
import type { MarketBriefPromptContext } from '../../data/marketBriefPrompt';
import type { MarketBrief, MarketBriefProductFit } from '../../services/aiMarketBrief';

function safeFormatDate(raw: unknown): string {
  if (!raw) return '—';
  const d = coerceToDate(raw);
  if (!d) return '—';
  return d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

countries.registerLocale(en as Parameters<typeof countries.registerLocale>[0]);

function fitBadgeClass(fit: MarketBriefProductFit['fit']): string {
  if (fit === 'strong') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (fit === 'weak') return 'bg-red-50 text-red-800 border-red-200';
  return 'bg-amber-50 text-amber-900 border-amber-200';
}

function CompareBriefColumn({
  row,
}: {
  row: { id: string; countryName: string; countryCode: string; brief: MarketBrief };
}) {
  const b = row.brief;
  return (
    <div className="rounded-xl border border-[#E5E5E5] bg-white p-4 space-y-3">
      <h5 className="text-base font-bold text-[#1A1A1A]">
        {row.countryName} <span className="text-[#9CA3AF]">({row.countryCode})</span>
      </h5>
      <p className="text-sm leading-relaxed text-[#4A4A4A] line-clamp-6">{b.executive_summary}</p>
      <div className="text-xs text-[#6B7280]">
        <span className="font-semibold text-[#1A1A1A]">Route:</span> {b.route_to_market.recommended}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[#E5E5E5] text-[#6B7280]">
              <th className="py-1 pr-2">Κατηγορία</th>
              <th className="py-1 pr-2">Low</th>
              <th className="py-1">High</th>
            </tr>
          </thead>
          <tbody>
            {b.price_benchmarking.slice(0, 6).map((r) => (
              <tr key={r.category} className="border-b border-[#F9FAFB]">
                <td className="py-1 pr-2 font-medium text-[#1A1A1A]">{r.category}</td>
                <td className="py-1 pr-2">{r.indicative_low ?? '—'}</td>
                <td className="py-1">{r.indicative_high ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="list-disc space-y-1 pl-4 text-xs text-[#4A4A4A]">
        {b.risks_barriers.slice(0, 5).map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function BriefPanel({ title, brief }: { title: string; brief: MarketBrief }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[#9CA3AF]">{title}</p>
        <h4 className="mt-1 text-base font-bold text-[#1A1A1A]">
          {brief.country_name} ({brief.country_code})
        </h4>
        {brief.vertical_focus ? (
          <p className="mt-1 text-xs text-[#6B7280]">Εστίαση: {brief.vertical_focus}</p>
        ) : null}
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">{brief.disclaimer}</div>
      <div>
        <p className="text-sm font-semibold text-[#1A1A1A]">Σύνοψη</p>
        <p className="mt-1 text-sm leading-relaxed text-[#4A4A4A] whitespace-pre-wrap">{brief.executive_summary}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[#E5E5E5] p-3">
          <p className="text-xs font-semibold text-[#6B7280]">Αγορά</p>
          <p className="mt-1 text-sm text-[#1A1A1A]">{brief.market_snapshot.size_signal}</p>
          <p className="mt-2 text-sm text-[#4A4A4A]">{brief.market_snapshot.growth_outlook}</p>
          <p className="mt-2 text-sm text-[#4A4A4A]">{brief.market_snapshot.maturity}</p>
        </div>
        <div className="rounded-lg border border-[#E5E5E5] p-3">
          <p className="text-xs font-semibold text-[#6B7280]">Κανάλια</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-[#4A4A4A]">
            {brief.market_snapshot.key_channels.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-[#1A1A1A]">Drivers ζήτησης</p>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-[#4A4A4A]">
          {brief.demand_drivers.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-sm font-semibold text-[#1A1A1A]">Ανταγωνισμός</p>
        <div className="mt-2 space-y-2">
          {brief.competitive_landscape.map((c) => (
            <div key={c.name} className="rounded-lg border border-[#E5E5E5] bg-[#FAFAFA] px-3 py-2 text-sm">
              <span className="font-medium text-[#1A1A1A]">{c.name}</span>
              <span className="text-[#6B7280]"> · {c.position}</span>
              <p className="mt-1 text-xs text-[#4A4A4A]">{c.notes}</p>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-[#1A1A1A]">Fit προϊόντων</p>
        <ul className="mt-2 space-y-2">
          {brief.product_fit.map((p) => (
            <li key={p.label} className={`rounded-lg border px-3 py-2 text-sm ${fitBadgeClass(p.fit)}`}>
              <span className="font-semibold">{p.label}</span>
              <span className="text-[#6B7280]"> ({p.fit})</span>
              <p className="mt-1 text-xs leading-snug opacity-90">{p.rationale}</p>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-sm font-semibold text-[#1A1A1A]">Τιμολόγηση (ενδεικτικά)</p>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#E5E5E5] text-xs text-[#6B7280]">
                <th className="py-2 pr-4">Κατηγορία</th>
                <th className="py-2 pr-4">Low</th>
                <th className="py-2 pr-4">High</th>
                <th className="py-2">Σημειώσεις</th>
              </tr>
            </thead>
            <tbody>
              {brief.price_benchmarking.map((row) => (
                <tr key={row.category} className="border-b border-[#F3F4F6]">
                  <td className="py-2 pr-4 font-medium text-[#1A1A1A]">{row.category}</td>
                  <td className="py-2 pr-4 text-[#4A4A4A]">{row.indicative_low ?? '—'}</td>
                  <td className="py-2 pr-4 text-[#4A4A4A]">{row.indicative_high ?? '—'}</td>
                  <td className="py-2 text-xs text-[#6B7280]">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-lg border border-[#E5E5E5] p-3">
        <p className="text-xs font-semibold text-[#6B7280]">Route to market</p>
        <p className="mt-1 text-sm font-medium text-[#1A1A1A]">{brief.route_to_market.recommended}</p>
        <p className="mt-1 text-sm text-[#4A4A4A]">{brief.route_to_market.rationale}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-[#1A1A1A]">Ρίσκα / εμπόδια</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-[#4A4A4A]">
            {brief.risks_barriers.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-[#1A1A1A]">Επόμενα validation steps</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-[#4A4A4A]">
            {brief.next_validation_steps.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function MarketBriefExplorer() {
  const toast = useToast();
  const { currentBrand } = useBrand();
  const { products, count: productsCount } = useProductSource();
  const { suppliers } = useSuppliers();
  const { activeStrategy, getStrategyName } = useActiveStrategy();
  const { briefs, isLoadingList, generateBrief, isGenerating, deleteBrief, isDeleting } = useMarketBriefs();

  const countryOptions = useMemo(() => {
    const names = countries.getNames('en', { select: 'official' }) as Record<string, string>;
    return Object.entries(names)
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'el'));
  }, []);

  const [countryCode, setCountryCode] = useState('DE');
  const [vertical, setVertical] = useState('');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);

  const topCategories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.category) set.add(String(p.category));
      if (set.size >= 12) break;
    }
    return [...set].slice(0, 8);
  }, [products]);

  const sampleSkus = useMemo(() => {
    return products
      .map((p) => (p.sku ? String(p.sku) : p.id))
      .filter(Boolean)
      .slice(0, 8) as string[];
  }, [products]);

  const handleGenerate = async () => {
    if (!currentBrand?.id) {
      toast.error('Επίλεξε brand');
      return;
    }
    const name = countries.getName(countryCode, 'en') || countryCode;
    const ctx: MarketBriefPromptContext = {
      brandName: currentBrand.name,
      brandType: currentBrand.type,
      countryName: name,
      countryCode: countryCode.toUpperCase(),
      verticalFocus: vertical.trim() || undefined,
      activeStrategyName: activeStrategy ? getStrategyName(activeStrategy.scenarioId) : undefined,
      topCategories,
      sampleSkus,
      productsCount,
      suppliersCount: suppliers.length,
    };
    try {
      const id = await generateBrief({ ctx });
      toast.success(`Market brief αποθηκεύτηκε για ${name}`);
      setDetailId(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Σφάλμα';
      toast.error(msg);
    }
  };

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) {
        toast.error('Μέχρι 3 χώρες για σύγκριση');
        return prev;
      }
      return [...prev, id];
    });
  };

  const compareBriefs = useMemo(() => {
    return compareIds
      .map((id) => briefs.find((b) => b.id === id))
      .filter((b): b is NonNullable<typeof b> => Boolean(b));
  }, [compareIds, briefs]);

  const detailBrief = useMemo(() => {
    if (!detailId) return null;
    return briefs.find((b) => b.id === detailId) ?? null;
  }, [detailId, briefs]);

  return (
    <Card>
      <div className="p-6 space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-[#1A1A1A]">AI Market Brief</h3>
            <p className="mt-1 text-sm text-[#6B7280]">
              Εκτίμηση από AI για χώρα και κλάδο. Δεν αντικαθιστά field research ή live pricing APIs.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1 min-w-0">
            <label htmlFor="market-brief-country" className="block text-xs font-medium text-[#6B7280] mb-1">
              Χώρα στόχος
            </label>
            <select
              id="market-brief-country"
              className="w-full max-w-md rounded-lg border border-[#E5E5E5] bg-white px-3 py-2 text-sm text-[#1A1A1A]"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
            >
              {countryOptions.map(({ code, name }) => (
                <option key={code} value={code}>
                  {name} ({code})
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-0">
            <label htmlFor="market-brief-vertical" className="block text-xs font-medium text-[#6B7280] mb-1">
              Κλάδος / vertical (προαιρετικό)
            </label>
            <input
              id="market-brief-vertical"
              type="text"
              placeholder="π.χ. industrial safety, B2B fasteners…"
              className="w-full max-w-md rounded-lg border border-[#E5E5E5] bg-white px-3 py-2 text-sm text-[#1A1A1A]"
              value={vertical}
              onChange={(e) => setVertical(e.target.value)}
            />
          </div>
          <Button
            variant="primary"
            icon={<Sparkles size={16} />}
            onClick={() => void handleGenerate()}
            disabled={isGenerating || !currentBrand?.id}
            className="shrink-0"
          >
            {isGenerating ? 'Δημιουργία…' : 'Δημιουργία brief'}
          </Button>
        </div>

        {isGenerating ? (
          <div className="flex items-center gap-2 text-sm text-[#6B7280]">
            <Spinner size="sm" />
            <span>Το AI συνθέτει το brief, μπορεί να πάρει ~20-40 δευτ.</span>
          </div>
        ) : null}

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[#1A1A1A]">Αποθηκευμένα briefs</p>
            {compareIds.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs text-[#6B7280]">
                <Columns3 size={14} />
                Σύγκριση: {compareIds.length}/3
              </span>
            ) : null}
          </div>
          {isLoadingList ? (
            <Spinner size="md" label="Φόρτωση briefs…" />
          ) : briefs.length === 0 ? (
            <p className="text-sm text-[#6B7280]">Δεν υπάρχουν ακόμα briefs για αυτό το brand.</p>
          ) : (
            <ul className="divide-y divide-[#F3F4F6] rounded-lg border border-[#E5E5E5]">
              {briefs.map((row) => (
                <li key={row.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-[#1A1A1A]">
                      {row.countryName}{' '}
                      <span className="text-[#9CA3AF]">({row.countryCode})</span>
                    </p>
                    <p className="text-xs text-[#6B7280] truncate">
                      Ενημέρωση: {safeFormatDate(row.updatedAt || row.createdAt)}
                      {row.verticalFocus ? ` · ${row.verticalFocus}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-2 text-xs text-[#4A4A4A]">
                      <input
                        type="checkbox"
                        checked={compareIds.includes(row.id)}
                        onChange={() => toggleCompare(row.id)}
                      />
                      Σύγκριση
                    </label>
                    <Button variant="secondary" size="sm" onClick={() => setDetailId(row.id)}>
                      Προβολή
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="text-red-700 border-red-200"
                      icon={<Trash2 size={14} />}
                      disabled={isDeleting}
                      onClick={() => {
                        if (!window.confirm('Διαγραφή αυτού του market brief;')) return;
                        void deleteBrief(row.id).then(() => toast.success('Διαγράφηκε')).catch(() => toast.error('Αποτυχία διαγραφής'));
                      }}
                    >
                      Διαγραφή
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {compareBriefs.length >= 2 ? (
          <div>
            <h4 className="text-sm font-semibold text-[#1A1A1A] mb-3">Σύγκριση χωρών</h4>
            <div className={`grid gap-4 ${compareBriefs.length === 2 ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}>
              {compareBriefs.map((row) => (
                <CompareBriefColumn
                  key={row.id}
                  row={{
                    id: row.id,
                    countryName: row.countryName,
                    countryCode: row.countryCode,
                    brief: row.brief,
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}

        {detailBrief && compareBriefs.length < 2 ? (
          <div className="rounded-xl border border-[#E5E5E5] p-4">
            <BriefPanel title="Επιλεγμένο brief" brief={detailBrief.brief} />
          </div>
        ) : null}

        {detailBrief && compareBriefs.length >= 2 ? (
          <p className="text-xs text-[#6B7280]">Η λεπτομερής προβολή ενός brief αποκρύπτεται όταν ενεργή η σύγκριση 2-3 χωρών.</p>
        ) : null}
      </div>
    </Card>
  );
}
