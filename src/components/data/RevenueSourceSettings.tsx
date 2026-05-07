import { useState, useMemo, useEffect } from 'react';
import { Card, Button, useToast, Tooltip } from '../common';
import { useBrand } from '../../hooks/useBrand';
import { useRefreshAggregates } from '../../hooks/useAggregates';
import { FirestoreService } from '../../services/firestore';
import { useQueryClient } from '@tanstack/react-query';
import type { Brand } from '../../types';

type Mode = NonNullable<Brand['revenueSourceMode']>;

interface ModeOption {
  id: Mode;
  label: string;
  description: string;
}

export function RevenueSourceSettings() {
  const { currentBrand, refreshBrands } = useBrand();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { refresh: refreshServerAggregates } = useRefreshAggregates();

  const initialMode = ((m: string | undefined): Mode => {
    if (m === 'eshop_all' || m === 'eshop_classified') return m;
    /** Legacy `erp` στο brand: πλέον ισοδυναμεί με ταξινόμηση καναλιών (το ERP τροφοδοτεί μόνο το Dashboard «Σύνολο Εσόδων»). */
    if (m === 'erp') return 'eshop_classified';
    return 'eshop_classified';
  })(currentBrand?.revenueSourceMode);

  const [selected, setSelected] = useState<Mode>(initialMode);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(
      ((m: string | undefined): Mode => {
        if (m === 'eshop_all' || m === 'eshop_classified') return m;
        if (m === 'erp') return 'eshop_classified';
        return 'eshop_classified';
      })(currentBrand?.revenueSourceMode)
    );
  }, [currentBrand?.id, currentBrand?.revenueSourceMode]);

  const options = useMemo((): ModeOption[] => {
    return [
      {
        id: 'eshop_classified',
        label: 'E-shop με ταξινόμηση καναλιών',
        description:
          'Default. Μετράει μόνο παραγγελίες classified ως «Direct e-shop» μέσω Sales Channel Rules. ' +
          'Εξαιρεί Skroutz, ενδοομιλικές, B2B wholesale κ.λπ. (με τους κανόνες που έχεις ορίσει). ' +
          'Ισχύει για τη σελίδα E-commerce και το `ecommerce_summary`.',
      },
      {
        id: 'eshop_all',
        label: 'E-shop χωρίς φιλτράρισμα',
        description:
          'Μετράει όλες τις non-cancelled παραγγελίες από τους e-shop connectors, χωρίς sales channel rules. ' +
          'Ο συνολικός τζίρος επιχείρησης στο Dashboard προέρχεται από ERP (αν συνδέεται) ή Procurement, όχι από εδώ.',
      },
    ];
  }, []);

  const dirty = useMemo(() => selected !== initialMode, [selected, initialMode]);

  const handleSave = async () => {
    if (!currentBrand) return;
    setSaving(true);
    try {
      await FirestoreService.updateDocument('brands', currentBrand.id, { revenueSourceMode: selected });
      await refreshBrands();
      queryClient.invalidateQueries({ queryKey: ['ecommerceOrdersRaw', currentBrand.id] });
      queryClient.invalidateQueries({ queryKey: ['dataAnalysisOrdersRaw', currentBrand.id] });
      queryClient.invalidateQueries({ queryKey: ['catalogAlignmentDataAnalysis', currentBrand.id] });
      const agg = await refreshServerAggregates();
      if (agg.ok) {
        toast.success('Αποθηκεύτηκε και ενημερώθηκε το σύνοψη e-shop στο server.');
      } else {
        queryClient.invalidateQueries({ queryKey: ['ecommerce_summary', currentBrand.id] });
        queryClient.invalidateQueries({ queryKey: ['business_revenue_summary', currentBrand.id] });
        toast.info(
          `Αποθηκεύτηκε η επιλογή, αλλά η ανανέωση summary απέτυχε (${agg.error ?? 'άγνωστο'}). Τρέξε χειροκίνητο sync ή δοκίμασε ξανά.`
        );
      }
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
            <h3 className="text-base font-semibold text-[var(--nts-charcoal)]">Ταξινόμηση τζίρου e-shop</h3>
            <Tooltip
              content="Ορίζει μόνο πώς φιλτράρονται οι παραγγελίες e-shop στο E-commerce summary και τα KPI e-shop. Ο συνολικός τζίρος επιχείρησης στο Dashboard προέρχεται από ERP ή Procurement (βλ. Οικονομικά)."
              size={13}
            />
          </div>
          <p className="text-[12px] text-[var(--nts-medium-gray)] mt-1">
            Brand: <strong className="text-[var(--nts-charcoal)]">{currentBrand.name}</strong>
          </p>
          <p className="text-[11px] text-[var(--nts-medium-gray)] mt-2 leading-relaxed">
            Τα <strong className="font-medium text-[var(--nts-charcoal)]">αποθέματα</strong> δεν εξαρτώνται από αυτή την επιλογή· για πραγματικό απόθεμα ERP κράτα ενεργό συγχρονισμό Megaventory/SoftOne (ή το κεντρικό import προϊόντων), ανεξάρτητα από τους κανόνες καναλιών.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {options.map((opt) => {
          const isSelected = selected === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSelected(opt.id)}
              className={[
                'w-full text-left p-3 rounded-lg border transition-all',
                'focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-1',
                isSelected
                  ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/5'
                  : 'border-[var(--nts-border-gray)] hover:border-[var(--nts-medium-gray)] bg-white',
                'cursor-pointer',
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
                  <span className="text-[13px] font-semibold text-[var(--nts-charcoal)]">{opt.label}</span>
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
