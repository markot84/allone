import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Card, Button, useToast, Tooltip } from '../common';
import { ColumnExcelFilter, type ExcelFilterOption } from '../common/ColumnExcelFilter';
import { useBrand } from '../../hooks/useBrand';
import { useSuppliers } from '../../hooks/useSuppliers';
import { useProductIntelligenceAggregateDoc } from '../../hooks/useProductIntelligenceAggregate';
import { FirestoreService } from '../../services/firestore';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '../../utils/logger';
import type { Brand, ThresholdOverrideRule } from '../../types';

type Thresholds = NonNullable<Brand['inventoryThresholds']>;
type FieldKey = Exclude<keyof Thresholds, 'reorderEmailEnabled' | 'thresholdOverrides'>;
type OverrideKey = keyof ThresholdOverrideRule['thresholds'];
// The 5 rule-overridable knobs (PER-320 Phase C); velocity window + availability-gate fields stay brand-level by design.
const OVERRIDE_KEYS: OverrideKey[] = ['lowDaysOfCover', 'excessDaysOfCover', 'newStockGraceDays', 'deadStockDays', 'slowMovingMaxDailySales'];
// The server-canonical value productFromRow coerces empty categories to — never store ''.
const UNCATEGORIZED = 'Uncategorized';

const FIELDS: { key: FieldKey; label: string; def: number; hint: string; step?: number }[] = [
  { key: 'velocityWindowDays', label: 'Παράθυρο πωλήσεων (ημέρες)', def: 30, hint: 'Σε πόσες ημέρες αναφέρεται η ταχύτητα πωλήσεων.' },
  { key: 'lowDaysOfCover', label: 'Όριο «Low Stock» (ημέρες κάλυψης)', def: 30, hint: 'Κάτω από τόσες ημέρες κάλυψης → «Low Stock».' },
  { key: 'excessDaysOfCover', label: 'Όριο «Excess Stock» (ημέρες κάλυψης)', def: 120, hint: 'Πάνω από τόσες ημέρες κάλυψης → «Excess Stock».' },
  { key: 'newStockGraceDays', label: 'Περίοδος χάριτος νέου αποθέματος (ημέρες)', def: 60, hint: 'Απόθεμα χωρίς πωλήσεις δεν χαρακτηρίζεται «Dead Stock» πριν περάσουν τόσες ημέρες από την παραλαβή.' },
  { key: 'deadStockDays', label: 'Όριο «Dead Stock» (ημέρες χωρίς πωλήσεις)', def: 60, hint: 'Απόθεμα χωρίς πωλήσεις πάνω από τόσες ημέρες χαρακτηρίζεται «Dead Stock». Ισχύει το μεγαλύτερο μεταξύ αυτού και της περιόδου χάριτος.' },
  { key: 'deadStockWindowDays', label: 'Παράθυρο ιστορικού «Dead Stock» (ημέρες)', def: 180, hint: 'Σε πόσες ημέρες ιστορικού διαθεσιμότητας ελέγχεται ο κανόνας «Dead Stock». Όσο το ιστορικό είναι μικρότερο, χρησιμοποιούνται οι διαθέσιμες ημέρες.' },
  { key: 'deadStockAvailabilityPct', label: 'Ελάχιστη διαθεσιμότητα «Dead Stock» (%)', def: 80, hint: 'Χαρακτηρισμός «Dead Stock» μόνο αν το προϊόν ήταν σε απόθεμα τουλάχιστον τόσο % των ημερών του παραθύρου — αλλιώς οι μηδενικές πωλήσεις εξηγούνται από έλλειψη.' },
  { key: 'slowMovingMaxDailySales', label: 'Όριο «Slow Moving» (πωλήσεις/ημέρα)', def: 0.1, step: 0.01, hint: 'Προϊόντα με πωλήσεις κάτω από τόσα τεμάχια την ημέρα (αλλά όχι μηδενικές) μαρκάρονται «Slow Moving». 0,1 ≈ 3 τεμάχια τον μήνα.' },
  { key: 'defaultLeadTimeDays', label: 'Προεπιλογή lead time προμηθευτή (ημέρες)', def: 30, hint: 'Εφεδρικός χρόνος παράδοσης όταν ο προμηθευτής δεν έχει δικό του lead time. Χρησιμοποιείται στον χαρακτηρισμό «Low Stock».' },
  { key: 'defaultTod', label: 'Προεπιλογή TOD ανά προμηθευτή (ημέρες)', def: 60, hint: 'Εφεδρικό Target Days of Stock όταν ο προμηθευτής δεν έχει δικό του TOD. Το κάθε προμηθευτής μπορεί να το υπερισχύσει στη σελίδα Προμηθευτών.' },
  { key: 'reorderWarningMultiplier', label: 'Σημείο επαναπαραγγελίας (× lead time)', def: 1.5, step: 0.1, hint: 'Πόσες φορές το lead time πρέπει να καλύπτει το απόθεμα πριν ειδοποιηθείτε για επαναπαραγγελία. 1.5 = ειδοποίηση 50% νωρίτερα από την εξάντληση.' },
];

/** Per-brand stock-health thresholds (Product Intelligence). Empty inputs keep the platform default.
 * Applied on the next product sync (the server reads them when it rebuilds the catalog). */
export function InventoryThresholdsCard() {
  const { currentBrand, refreshBrands } = useBrand();
  const queryClient = useQueryClient();
  const toast = useToast();

  const stored = currentBrand?.inventoryThresholds;
  const initial = useMemo<Record<FieldKey, string>>(() => {
    const o = {} as Record<FieldKey, string>;
    for (const f of FIELDS) o[f.key] = stored?.[f.key] != null ? String(stored[f.key]) : '';
    return o;
  }, [stored]);

  const [vals, setVals] = useState<Record<FieldKey, string>>(initial);
  const [reorderEmail, setReorderEmail] = useState(stored?.reorderEmailEnabled ?? false);
  const [rules, setRules] = useState<ThresholdOverrideRule[]>(stored?.thresholdOverrides ?? []);
  const [saving, setSaving] = useState(false);
  useEffect(() => setVals(initial), [currentBrand?.id, initial]);
  useEffect(() => setReorderEmail(stored?.reorderEmailEnabled ?? false), [currentBrand?.id, stored]);
  useEffect(() => setRules(stored?.thresholdOverrides ?? []), [currentBrand?.id, stored]);

  const { aggregate } = useProductIntelligenceAggregateDoc();
  const { suppliers } = useSuppliers();
  const categoryOptions = useMemo((): ExcelFilterOption[] =>
    (aggregate?.categories ?? [])
      .map((c) => ({ id: c.name?.trim() ? c.name : UNCATEGORIZED, label: c.name?.trim() ? c.name : '(Κενή κατηγορία)' }))
      .sort((a, b) => a.label.localeCompare(b.label, 'el')),
    [aggregate?.categories]);
  const supplierOptions = useMemo((): ExcelFilterOption[] =>
    suppliers
      .map((s) => s.name?.trim())
      .filter((n): n is string => !!n)
      .map((n) => ({ id: n, label: n }))
      .sort((a, b) => a.label.localeCompare(b.label, 'el')),
    [suppliers]);
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of aggregate?.categories ?? []) m.set(c.name?.trim() ? c.name : UNCATEGORIZED, c.count);
    return m;
  }, [aggregate?.categories]);

  const dirty = useMemo(
    () => FIELDS.some((f) => vals[f.key] !== initial[f.key])
      || reorderEmail !== (stored?.reorderEmailEnabled ?? false)
      || JSON.stringify(rules) !== JSON.stringify(stored?.thresholdOverrides ?? []),
    [vals, initial, reorderEmail, rules, stored],
  );

  const ruleInvalid = (r: ThresholdOverrideRule) => !(r.categories?.length || r.suppliers?.length);

  const handleSave = async () => {
    if (!currentBrand) return;
    const next: Thresholds = {};
    for (const f of FIELDS) {
      const n = Number(vals[f.key]);
      if (vals[f.key].trim() !== '' && Number.isFinite(n) && n > 0) next[f.key] = n;
    }
    next.reorderEmailEnabled = reorderEmail;
    // This card is the ONLY writer of inventoryThresholds — a second writer would recreate the PER-182/183 merge-wipe class.
    const serialized = rules
      .filter((r) => !ruleInvalid(r))
      .map((r) => ({
        id: r.id,
        ...(r.label?.trim() ? { label: r.label.trim() } : {}),
        ...(r.categories?.length ? { categories: r.categories } : {}),
        ...(r.suppliers?.length ? { suppliers: r.suppliers } : {}),
        thresholds: Object.fromEntries(Object.entries(r.thresholds).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0)),
      }))
      .filter((r) => Object.keys(r.thresholds).length > 0);
    if (serialized.length) next.thresholdOverrides = serialized as ThresholdOverrideRule[];
    setSaving(true);
    try {
      await FirestoreService.updateDocument('brands', currentBrand.id, { inventoryThresholds: next } as Partial<Brand>);
      await refreshBrands();
      queryClient.invalidateQueries({ queryKey: ['productIntelligenceAggregate', currentBrand.id] });
      toast.success('Αποθηκεύτηκε. Εφαρμόζεται στο επόμενο sync προϊόντων.');
    } catch (err) {
      logger.error('[InventoryThresholdsCard] save failed:', { err });
      toast.error('Αποτυχία αποθήκευσης. Δοκιμάστε ξανά.');
    } finally {
      setSaving(false);
    }
  };

  if (!currentBrand) return null;

  return (
    <Card padding="lg">
      <div className="mb-4">
        <div className="flex items-center gap-1.5">
          <h3 className="text-base font-semibold text-[var(--nts-charcoal)]">Όρια υγείας αποθέματος</h3>
          <Tooltip content="Ρυθμίζει την κατηγοριοποίηση Stock Status / Stock Age στο Product Intelligence. Κενό πεδίο = προεπιλογή. Εφαρμόζεται στο επόμενο sync προϊόντων." size={13} />
        </div>
        <p className="text-[12px] text-[var(--nts-medium-gray)] mt-1">
          Brand: <strong className="text-[var(--nts-charcoal)]">{currentBrand.name}</strong>
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="flex items-center gap-1 text-[12px] font-medium text-[var(--nts-charcoal)]">
              {f.label}
              <Tooltip content={f.hint} size={12} />
            </span>
            <input
              type="number"
              // Days are whole numbers; the reorder multiplier is fractional (1.5), so a
              // step of 1 would make the browser reject it as invalid.
              min={f.step ?? 1}
              step={f.step ?? 1}
              inputMode={f.step ? 'decimal' : 'numeric'}
              value={vals[f.key]}
              placeholder={`Προεπιλογή ${f.def}`}
              onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--nts-border-gray)] bg-white text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)]"
            />
          </label>
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-[var(--nts-border-gray)]">
        <div className="flex items-center gap-1.5">
          <h4 className="text-[13px] font-semibold text-[var(--nts-charcoal)]">Ειδικά όρια ανά κατηγορία/προμηθευτή</h4>
          <Tooltip content="Ισχύει ο πρώτος κανόνας που ταιριάζει· κενό πεδίο = κληρονομεί την τιμή του brand· σε ομαδοποιημένες γραμμές μετράει η κύρια παραλλαγή· οι αλλαγές εφαρμόζονται στο επόμενο sync προϊόντων." size={13} />
        </div>
        {rules.map((r, i) => {
          const stale = [
            ...(r.categories ?? []).filter((c) => !categoryOptions.some((o) => o.id === c)),
            ...(r.suppliers ?? []).filter((s) => !supplierOptions.some((o) => o.id === s)),
          ];
          const matchCount = (r.categories ?? []).reduce((t, c) => t + (categoryCounts.get(c) ?? 0), 0);
          const upd = (patch: Partial<ThresholdOverrideRule>) => setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
          return (
            <div key={r.id} className="mt-3 p-3 rounded-lg border border-[var(--nts-border-gray)] bg-[#FAFAFA]/60">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={r.label ?? ''}
                  placeholder={`Κανόνας ${i + 1}`}
                  onChange={(e) => upd({ label: e.target.value })}
                  className="w-36 px-2 py-1 rounded-lg border border-[var(--nts-border-gray)] bg-white text-[12px]"
                />
                <ColumnExcelFilter label="Κατηγορίες" options={categoryOptions} value={r.categories ?? []} onChange={(v) => upd({ categories: v ?? [] })} selectionMode="additive" />
                <ColumnExcelFilter label="Προμηθευτές" options={supplierOptions} value={r.suppliers ?? []} onChange={(v) => upd({ suppliers: v ?? [] })} selectionMode="additive" />
                {r.categories?.length ? <span className="text-[11px] text-[var(--nts-medium-gray)]">~{matchCount.toLocaleString('el')} προϊόντα</span> : null}
                <span className="flex-1" />
                <button type="button" disabled={i === 0} onClick={() => setRules((rs) => { const n = [...rs]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })} className="p-1 text-[var(--nts-medium-gray)] disabled:opacity-30" aria-label="Πάνω"><ArrowUp size={14} /></button>
                <button type="button" disabled={i === rules.length - 1} onClick={() => setRules((rs) => { const n = [...rs]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })} className="p-1 text-[var(--nts-medium-gray)] disabled:opacity-30" aria-label="Κάτω"><ArrowDown size={14} /></button>
                <button type="button" onClick={() => setRules((rs) => rs.filter((x) => x.id !== r.id))} className="p-1 text-red-500" aria-label="Διαγραφή"><Trash2 size={14} /></button>
              </div>
              {stale.length > 0 && (
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-600"><AlertTriangle size={12} />{stale.join(', ')}: δεν υπάρχει πλέον στον κατάλογο — ο κανόνας δεν θα ταιριάξει.</p>
              )}
              {ruleInvalid(r) && (
                <p className="mt-1.5 text-[11px] text-red-500">Επιλέξτε τουλάχιστον μία κατηγορία ή προμηθευτή — αλλιώς ο κανόνας δεν αποθηκεύεται.</p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2">
                {FIELDS.filter((f) => (OVERRIDE_KEYS as string[]).includes(f.key)).map((f) => (
                  <label key={f.key} className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-1 text-[11px] text-[var(--nts-charcoal)]">{f.label}<Tooltip content={f.hint} size={11} /></span>
                    <input
                      type="number"
                      min={f.step ?? 1}
                      step={f.step ?? 1}
                      inputMode={f.step ? 'decimal' : 'numeric'}
                      value={r.thresholds[f.key as OverrideKey] ?? ''}
                      placeholder={`Κληρονομεί: ${vals[f.key] || f.def}`}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        const th = { ...r.thresholds };
                        if (e.target.value.trim() === '' || !Number.isFinite(n) || n <= 0) delete th[f.key as OverrideKey];
                        else th[f.key as OverrideKey] = n;
                        upd({ thresholds: th });
                      }}
                      className="w-full px-2 py-1 rounded-lg border border-[var(--nts-border-gray)] bg-white text-[12px]"
                    />
                  </label>
                ))}
              </div>
            </div>
          );
        })}
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => setRules((rs) => [...rs, { id: crypto.randomUUID(), thresholds: {} }])}
        >
          <Plus size={14} className="mr-1" /> Προσθήκη κανόνα
        </Button>
      </div>

      <label className="flex items-start gap-2 mt-4 cursor-pointer">
        <input
          type="checkbox"
          checked={reorderEmail}
          onChange={(e) => setReorderEmail(e.target.checked)}
          className="mt-0.5 accent-[var(--nts-accent)]"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-[12px] font-medium text-[var(--nts-charcoal)]">Εβδομαδιαίο email επαναπαραγγελίας</span>
          <span className="text-[11px] text-[var(--nts-medium-gray)]">Κάθε Δευτέρα πρωί: προϊόντα σε Low Stock ομαδοποιημένα ανά προμηθευτή, στους παραλήπτες του daily digest.</span>
        </span>
      </label>

      <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-[var(--nts-border-gray)]">
        {dirty && <span className="text-[11px] text-[var(--nts-medium-gray)]">Μη αποθηκευμένες αλλαγές</span>}
        <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? 'Αποθήκευση…' : 'Αποθήκευση'}
        </Button>
      </div>
    </Card>
  );
}
