import { useState, useEffect, useMemo } from 'react';
import { Card, Button, useToast, Tooltip } from '../common';
import { useBrand } from '../../hooks/useBrand';
import { FirestoreService } from '../../services/firestore';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '../../utils/logger';
import type { Brand } from '../../types';

type Thresholds = NonNullable<Brand['inventoryThresholds']>;
type FieldKey = Exclude<keyof Thresholds, 'reorderEmailEnabled'>;

const FIELDS: { key: FieldKey; label: string; def: number; hint: string; step?: number }[] = [
  { key: 'velocityWindowDays', label: 'Παράθυρο πωλήσεων (ημέρες)', def: 30, hint: 'Σε πόσες ημέρες αναφέρεται η ταχύτητα πωλήσεων.' },
  { key: 'lowDaysOfCover', label: 'Όριο «Low Stock» (ημέρες κάλυψης)', def: 30, hint: 'Κάτω από τόσες ημέρες κάλυψης → «Low Stock».' },
  { key: 'excessDaysOfCover', label: 'Όριο «Excess Stock» (ημέρες κάλυψης)', def: 120, hint: 'Πάνω από τόσες ημέρες κάλυψης → «Excess Stock».' },
  { key: 'newStockGraceDays', label: 'Περίοδος χάριτος νέου αποθέματος (ημέρες)', def: 60, hint: 'Απόθεμα χωρίς πωλήσεις δεν χαρακτηρίζεται «Dead Stock» πριν περάσουν τόσες ημέρες από την παραλαβή.' },
  { key: 'deadStockDays', label: 'Όριο «Dead Stock» (ημέρες χωρίς πωλήσεις)', def: 60, hint: 'Απόθεμα χωρίς πωλήσεις πάνω από τόσες ημέρες χαρακτηρίζεται «Dead Stock». Ισχύει το μεγαλύτερο μεταξύ αυτού και της περιόδου χάριτος.' },
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
  const [saving, setSaving] = useState(false);
  useEffect(() => setVals(initial), [currentBrand?.id, initial]);
  useEffect(() => setReorderEmail(stored?.reorderEmailEnabled ?? false), [currentBrand?.id, stored]);

  const dirty = useMemo(
    () => FIELDS.some((f) => vals[f.key] !== initial[f.key]) || reorderEmail !== (stored?.reorderEmailEnabled ?? false),
    [vals, initial, reorderEmail, stored],
  );

  const handleSave = async () => {
    if (!currentBrand) return;
    const next: Thresholds = {};
    for (const f of FIELDS) {
      const n = Number(vals[f.key]);
      if (vals[f.key].trim() !== '' && Number.isFinite(n) && n > 0) next[f.key] = n;
    }
    next.reorderEmailEnabled = reorderEmail;
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
