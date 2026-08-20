import { useState, useEffect, useMemo } from 'react';
import { Card, Button, useToast, Tooltip } from '../common';
import { useBrand } from '../../hooks/useBrand';
import { FirestoreService } from '../../services/firestore';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '../../utils/logger';
import type { Brand } from '../../types';

type Rules = NonNullable<Brand['nonMerchandise']>;
type ListKey = keyof Rules;

const LISTS: { key: ListKey; label: string; hint: string; placeholder: string }[] = [
  {
    key: 'categories',
    label: 'Κατηγορίες',
    hint: 'Ακριβής αντιστοίχιση ονόματος κατηγορίας (αδιάφορη σε πεζά/κεφαλαία και τόνους). Οι υποκατηγορίες δηλώνονται ξεχωριστά.',
    placeholder: 'π.χ. Δωροεπιταγές',
  },
  {
    key: 'nameContains',
    label: 'Όνομα προϊόντος περιέχει',
    hint: 'Το προϊόν εξαιρείται όταν το όνομά του περιέχει τη φράση (αδιάφορη σε πεζά/κεφαλαία και τόνους).',
    placeholder: 'π.χ. Unstrung',
  },
];

/** PER-293 — per-brand non-merchandise rules: out of stock analytics, revenue kept; applied on next sync/rebuild. */
export function NonMerchandiseCard() {
  const { currentBrand, refreshBrands } = useBrand();
  const queryClient = useQueryClient();
  const toast = useToast();

  const stored = currentBrand?.nonMerchandise;
  const initial = useMemo<Record<ListKey, string[]>>(
    () => ({ categories: stored?.categories ?? [], nameContains: stored?.nameContains ?? [] }),
    [stored],
  );

  const [vals, setVals] = useState(initial);
  const [drafts, setDrafts] = useState<Record<ListKey, string>>({ categories: '', nameContains: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { setVals(initial); setDrafts({ categories: '', nameContains: '' }); }, [currentBrand?.id, initial]);

  const dirty = useMemo(
    () => LISTS.some((l) => JSON.stringify(vals[l.key]) !== JSON.stringify(initial[l.key])),
    [vals, initial],
  );

  const addDraft = (key: ListKey) => {
    const v = drafts[key].trim();
    if (!v) return;
    setVals((cur) => (cur[key].some((x) => x.toLowerCase() === v.toLowerCase()) ? cur : { ...cur, [key]: [...cur[key], v] }));
    setDrafts((d) => ({ ...d, [key]: '' }));
  };
  const remove = (key: ListKey, value: string) =>
    setVals((cur) => ({ ...cur, [key]: cur[key].filter((x) => x !== value) }));

  const handleSave = async () => {
    if (!currentBrand) return;
    setSaving(true);
    try {
      await FirestoreService.updateDocument('brands', currentBrand.id, { nonMerchandise: vals } as Partial<Brand>);
      await refreshBrands();
      queryClient.invalidateQueries({ queryKey: ['productIntelligenceAggregate', currentBrand.id] });
      toast.success('Αποθηκεύτηκε. Εφαρμόζεται στο επόμενο sync/rebuild.');
    } catch (err) {
      logger.error('[NonMerchandiseCard] save failed:', { err });
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
          <h3 className="text-base font-semibold text-[var(--nts-charcoal)]">Μη εμπορεύσιμα προϊόντα</h3>
          <Tooltip
            content="Μόνιμος χαρακτηρισμός brand: προϊόντα χωρίς πραγματικό απόθεμα (υπηρεσίες, δωροεπιταγές, κατά παραγγελία). Διαφορετικό από τις εξαιρούμενες κατηγορίες ανά στρατηγική πωλήσεων, που ισχύουν μόνο για τη συγκεκριμένη στρατηγική."
            size={13}
          />
        </div>
        <p className="text-[12px] text-[var(--nts-medium-gray)] mt-1">
          <strong className="text-[var(--nts-charcoal)]">Δεν μετρούν ως απόθεμα. Ο τζίρος τους συνεχίζει να μετράει.</strong>
          {' '}Brand: <strong className="text-[var(--nts-charcoal)]">{currentBrand.name}</strong>
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {LISTS.map((l) => (
          <div key={l.key} className="flex flex-col gap-2">
            <span className="flex items-center gap-1 text-[12px] font-medium text-[var(--nts-charcoal)]">
              {l.label}
              <Tooltip content={l.hint} size={12} />
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                value={drafts[l.key]}
                placeholder={l.placeholder}
                onChange={(e) => setDrafts((d) => ({ ...d, [l.key]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDraft(l.key); } }}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--nts-border-gray)] bg-white text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)]"
              />
              <Button variant="secondary" size="sm" disabled={!drafts[l.key].trim()} onClick={() => addDraft(l.key)}>
                Προσθήκη
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {vals[l.key].length === 0 && (
                <span className="text-[11px] text-[var(--nts-medium-gray)]">Καμία εξαίρεση — ισχύουν μόνο οι προεπιλογές πλατφόρμας.</span>
              )}
              {vals[l.key].map((v) => (
                <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--nts-light-gray)] text-[12px] text-[var(--nts-charcoal)]">
                  {v}
                  <button type="button" onClick={() => remove(l.key, v)} aria-label={`Αφαίρεση ${v}`} className="text-[var(--nts-medium-gray)] hover:text-[var(--nts-charcoal)]">
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
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
