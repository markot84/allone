import { useState, useEffect, useMemo } from 'react';
import { Card, Button, useToast, Tooltip } from '../common';
import { useBrand } from '../../hooks/useBrand';
import { FirestoreService } from '../../services/firestore';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '../../utils/logger';
import type { Brand } from '../../types';

type Thresholds = NonNullable<Brand['inventoryThresholds']>;
type FieldKey = keyof Thresholds;

const FIELDS: { key: FieldKey; label: string; def: number; hint: string }[] = [
  { key: 'velocityWindowDays', label: 'Παράθυρο πωλήσεων (ημέρες)', def: 30, hint: 'Σε πόσες ημέρες αναφέρεται η ταχύτητα πωλήσεων.' },
  { key: 'lowDaysOfCover', label: 'Όριο «Χαμηλού» (ημέρες κάλυψης)', def: 30, hint: 'Κάτω από τόσες ημέρες κάλυψης → «Χαμηλό απόθεμα».' },
  { key: 'excessDaysOfCover', label: 'Όριο «Υπερβολικού» (ημέρες κάλυψης)', def: 120, hint: 'Πάνω από τόσες ημέρες κάλυψης → «Υπερβολικό απόθεμα».' },
  { key: 'newStockGraceDays', label: 'Περίοδος χάριτος νέου αποθέματος (ημέρες)', def: 60, hint: 'Απόθεμα χωρίς πωλήσεις δεν χαρακτηρίζεται «Νεκρό» πριν περάσουν τόσες ημέρες από την παραλαβή.' },
  { key: 'defaultLeadTimeDays', label: 'Προεπιλογή lead time προμηθευτή (ημέρες)', def: 0, hint: 'Εφεδρικός χρόνος παράδοσης όταν ο προμηθευτής δεν έχει δικό του lead time. Χρησιμοποιείται στον χαρακτηρισμό «Χαμηλού αποθέματος».' },
  { key: 'defaultTod', label: 'Προεπιλογή TOD ανά προμηθευτή (ημέρες)', def: 60, hint: 'Εφεδρικό Target Days of Stock όταν ο προμηθευτής δεν έχει δικό του TOD. Το κάθε προμηθευτής μπορεί να το υπερισχύσει στη σελίδα Προμηθευτών.' },
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
  const [saving, setSaving] = useState(false);
  useEffect(() => setVals(initial), [currentBrand?.id, initial]);

  const dirty = useMemo(() => FIELDS.some((f) => vals[f.key] !== initial[f.key]), [vals, initial]);

  const handleSave = async () => {
    if (!currentBrand) return;
    const next: Thresholds = {};
    for (const f of FIELDS) {
      const n = Number(vals[f.key]);
      if (vals[f.key].trim() !== '' && Number.isFinite(n) && n > 0) next[f.key] = n;
    }
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
              min={1}
              inputMode="numeric"
              value={vals[f.key]}
              placeholder={`Προεπιλογή ${f.def}`}
              onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--nts-border-gray)] bg-white text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)]"
            />
          </label>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-[var(--nts-border-gray)]">
        {dirty && <span className="text-[11px] text-[var(--nts-medium-gray)]">Μη αποθηκευμένες αλλαγές</span>}
        <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? 'Αποθήκευση…' : 'Αποθήκευση'}
        </Button>
      </div>
    </Card>
  );
}
