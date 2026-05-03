import { useState, useMemo, useEffect } from 'react';
import { Card, Button, useToast, Tooltip } from '../common';
import { useBrand } from '../../hooks/useBrand';
import { FirestoreService } from '../../services/firestore';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Brand } from '../../types';

type Mode = NonNullable<Brand['revenueSourceMode']>;

interface ModeOption {
  id: Mode;
  label: string;
  description: string;
  /** Μήνυμα όταν η επιλογή είναι ανενεργή (π.χ. λείπει σύνδεση ERP). */
  disabledReason?: string | null;
}

function resolveConnectorErpAvailable(conn: Record<string, unknown> | null): boolean {
  if (!conn) return false;
  const mv = conn.megaventory as Record<string, unknown> | undefined;
  if (mv?.connected) return true;
  const s1 = conn.softone as Record<string, unknown> | undefined;
  return Boolean(s1?.connected === true && s1?.syncSalesDocs === true);
}

export function RevenueSourceSettings() {
  const { currentBrand, refreshBrands } = useBrand();
  const queryClient = useQueryClient();
  const toast = useToast();

  const brandId = currentBrand?.id ?? null;

  const { data: connectorsDoc } = useQuery({
    queryKey: ['connectorsForRevenueSource', brandId],
    queryFn: () =>
      brandId ? FirestoreService.getDocument<Record<string, unknown>>('connectors', brandId) : Promise.resolve(null),
    enabled: Boolean(brandId),
    staleTime: 60_000,
  });

  const erpAvailable = resolveConnectorErpAvailable(connectorsDoc ?? null);

  const initialMode = (currentBrand?.revenueSourceMode || 'eshop_classified') as Mode;
  const [selected, setSelected] = useState<Mode>(initialMode);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected((currentBrand?.revenueSourceMode || 'eshop_classified') as Mode);
  }, [currentBrand?.id, currentBrand?.revenueSourceMode]);

  const options = useMemo((): ModeOption[] => {
    return [
      {
        id: 'eshop_classified',
        label: 'E-shop με ταξινόμηση καναλιών',
        description:
          'Default. Μετράει μόνο παραγγελίες classified ως «Direct e-shop» μέσω Sales Channel Rules. ' +
          'Εξαιρεί Skroutz, ενδοομιλικές, B2B wholesale κ.λπ. (με τους κανόνες που έχεις ορίσει).',
      },
      {
        id: 'eshop_all',
        label: 'E-shop χωρίς φιλτράρισμα',
        description:
          'Μετράει όλες τις non-cancelled παραγγελίες από τους e-shop connectors, χωρίς sales channel rules. ' +
          'Για brands χωρίς marketplace/intercompany στο ηλεκτρονικό κατάστημα.',
      },
      {
        id: 'erp',
        label: 'ERP (Megaventory τιμολόγια / SoftOne SALDOC)',
        description:
          'Ο τζίρος KPI προέρχεται από τα επίσημα παραστατικά: προτεραιότητα Megaventory Sales Invoices ' +
          '(megaventory_invoices), αλλιώς SoftOne πωλήσεις αν είναι ενεργό το sync SALDOC. ' +
          'Καλύπτει και καταστήματα/B2B/offline που δεν φαίνονται στο eshop. Μετά το sync ERP γίνεται ενημέρωση του summary.',
        disabledReason: erpAvailable ? null : 'Σύνδεσε Megaventory ή SoftOne με ενεργό συγχρονισμό SALDOC.',
      },
    ];
  }, [erpAvailable]);

  const dirty = useMemo(() => selected !== initialMode, [selected, initialMode]);

  const handleSave = async () => {
    if (!currentBrand) return;
    setSaving(true);
    try {
      await FirestoreService.updateDocument('brands', currentBrand.id, { revenueSourceMode: selected });
      await refreshBrands();
      queryClient.invalidateQueries({ queryKey: ['ecommerceOrdersRaw', currentBrand.id] });
      queryClient.invalidateQueries({ queryKey: ['ecommerce_summary', currentBrand.id] });
      toast.success(
        selected === 'erp'
          ? 'Αποθηκεύτηκε πηγή ERP. Τρέξε Sync στο Megaventory ή στο SoftOne (ή περίμενε το νυχτερινό ERP κύμα) για να γραφτεί το ecommerce_summary.'
          : 'Αποθηκεύτηκε. Τα νούμερα θα ανανεωθούν μετά το επόμενο aggregation ή χειροκίνητο e-shop sync.'
      );
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
              content="Ορίζει μόνο τον υπολογισμό τζίρου (Dashboard / ecommerce_summary · raw παραγγελίες για KPI). Δεν αλλάζει κατάλογο ή αποθέματα — αυτά προέρχονται από το ERP sync / import προϊόντων και τους commerce connectors όπως τους έχεις συνδέσει."
              size={13}
            />
          </div>
          <p className="text-[12px] text-[var(--nts-medium-gray)] mt-1">
            Brand: <strong className="text-[var(--nts-charcoal)]">{currentBrand.name}</strong>
          </p>
          <p className="text-[11px] text-[var(--nts-medium-gray)] mt-2 leading-relaxed">
            Τα <strong className="font-medium text-[var(--nts-charcoal)]">αποθέματα</strong> δεν εξαρτώνται από αυτή την επιλογή· για πραγματικό απόθεμα ERP κράτα ενεργό συγχρονισμό Megaventory/SoftOne (ή το κεντρικό import προϊόντων), ανεξάρτητα αν ο τζίρος μετράει από eshop ή από τιμολόγια.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {options.map((opt) => {
          const isSelected = selected === opt.id;
          const disabled = Boolean(opt.disabledReason);
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
                    {disabled && opt.disabledReason && (
                      <span
                        className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--nts-light-gray)] text-[var(--nts-medium-gray)] border border-[var(--nts-border-gray)]"
                        title={opt.disabledReason}
                      >
                        Απαιτείται σύνδεση ERP
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-[var(--nts-medium-gray)] leading-relaxed mt-0.5">{opt.description}</p>
                  {disabled && opt.disabledReason && (
                    <p className="text-[11px] text-[var(--nts-accent)] mt-1">{opt.disabledReason}</p>
                  )}
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
