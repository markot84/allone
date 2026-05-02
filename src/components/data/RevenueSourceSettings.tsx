import { useState, useMemo } from 'react';
import { Card, Button, useToast, Tooltip } from '../common';
import { useBrand } from '../../hooks/useBrand';
import { FirestoreService } from '../../services/firestore';
import { useQueryClient } from '@tanstack/react-query';
import type { Brand } from '../../types';

type Mode = NonNullable<Brand['revenueSourceMode']>;

interface ModeOption {
  id: Mode;
  label: string;
  description: string;
  available: boolean;
}

const OPTIONS: ModeOption[] = [
  {
    id: 'eshop_classified',
    label: 'E-shop με ταξινόμηση καναλιών',
    description:
      'Default. Μετράει μόνο παραγγελίες classified ως «Direct e-shop» μέσω Sales Channel Rules. ' +
      'Εξαιρεί αυτόματα Skroutz, ενδοομιλικές, B2B wholesale κ.λπ. (αρκεί να έχουν δηλωθεί rules).',
    available: true,
  },
  {
    id: 'eshop_all',
    label: 'E-shop χωρίς φιλτράρισμα',
    description:
      'Μετράει όλες τις non-cancelled παραγγελίες από τους e-shop connectors, χωρίς να σέβεται sales ' +
      'channel rules. Κατάλληλο για brands χωρίς marketplaces ή intercompany πωλήσεις.',
    available: true,
  },
  {
    id: 'erp',
    label: 'ERP (Phase 2)',
    description:
      'Τραβάει τον συνολικό τζίρο από το ERP (Megaventory / SoftOne / Epsilon Net / Entersoft). ' +
      'Περιλαμβάνει φυσικά καταστήματα, B2B και offline κανάλια. Διαθέσιμο σε επόμενο iteration.',
    available: false,
  },
];

export function RevenueSourceSettings() {
  const { currentBrand, refreshBrands } = useBrand();
  const queryClient = useQueryClient();
  const toast = useToast();

  const initialMode = (currentBrand?.revenueSourceMode || 'eshop_classified') as Mode;
  const [selected, setSelected] = useState<Mode>(initialMode);
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => selected !== initialMode, [selected, initialMode]);

  const handleSave = async () => {
    if (!currentBrand) return;
    setSaving(true);
    try {
      await FirestoreService.updateDocument('brands', currentBrand.id, { revenueSourceMode: selected });
      await refreshBrands();
      // Force re-aggregation of ecom data on the client (raw orders re-classified).
      queryClient.invalidateQueries({ queryKey: ['ecommerceOrdersRaw', currentBrand.id] });
      queryClient.invalidateQueries({ queryKey: ['ecommerce_summary', currentBrand.id] });
      toast.success('Αποθηκεύτηκε. Τα νούμερα θα ανανεωθούν στις επόμενες σελίδες.');
    } catch (err) {
      console.error('[RevenueSourceSettings] save failed:', err);
      toast.error('Αποτυχία αποθήκευσης. Δοκιμάστε ξανά.');
    } finally {
      setSaving(false);
    }
  };

  if (!currentBrand) return null;

  return (
    <Card padding="lg">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-semibold text-[var(--nts-charcoal)]">Πηγή Εσόδων (Revenue Source)</h3>
            <Tooltip
              content="Ορίζει από πού αντλεί το «Σύνολο Εσόδων» στο Dashboard και στα ROI KPIs. Διαφορετικά brands έχουν διαφορετικές απαιτήσεις (online μόνο vs. ERP-based)."
              size={13}
            />
          </div>
          <p className="text-[12px] text-[var(--nts-medium-gray)] mt-1">
            Brand: <strong className="text-[var(--nts-charcoal)]">{currentBrand.name}</strong>
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {OPTIONS.map((opt) => {
          const isSelected = selected === opt.id;
          const disabled = !opt.available;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && setSelected(opt.id)}
              className={[
                'w-full text-left p-3 rounded-lg border transition-all',
                'focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-1',
                isSelected
                  ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/5'
                  : 'border-[var(--nts-border-gray)] hover:border-[var(--nts-medium-gray)] bg-white',
                disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
              ].join(' ')}
            >
              <div className="flex items-start gap-3">
                <span
                  className={[
                    'mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border-2',
                    isSelected
                      ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]'
                      : 'border-[var(--nts-border-gray)] bg-white',
                  ].join(' ')}
                  aria-hidden
                >
                  {isSelected && <span className="block w-1.5 h-1.5 m-[3px] rounded-full bg-white" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-[var(--nts-charcoal)]">{opt.label}</span>
                    {!opt.available && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--nts-light-gray)] text-[var(--nts-medium-gray)] border border-[var(--nts-border-gray)]">
                        Coming soon
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-[var(--nts-medium-gray)] leading-relaxed mt-0.5">{opt.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-[var(--nts-border-gray)]">
        {dirty && (
          <span className="text-[11px] text-[var(--nts-medium-gray)]">Μη αποθηκευμένες αλλαγές</span>
        )}
        <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? 'Αποθήκευση…' : 'Αποθήκευση'}
        </Button>
      </div>
    </Card>
  );
}
