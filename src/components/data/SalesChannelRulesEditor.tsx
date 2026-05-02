import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Spinner, useToast, Tooltip } from '../common';
import { useBrand } from '../../hooks/useBrand';
import { FirestoreService } from '../../services/firestore';
import { doc, deleteField, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { Plus, Trash2, Save, X } from 'lucide-react';
import {
  SALES_CHANNEL_LABELS,
  type EcommerceSalesChannel,
  type EcommerceSalesChannelRule,
} from '../../services/ecommerceSalesChannel';

const CHANNEL_OPTIONS: Array<{ id: EcommerceSalesChannel; label: string; included: boolean }> = [
  { id: 'direct_eshop', label: 'Direct e-shop (περιλαμβάνεται)', included: true },
  { id: 'intercompany', label: 'Ενδοομιλικά (εξαιρείται)', included: false },
  { id: 'marketplace_skroutz', label: 'Skroutz / Marketplace (εξαιρείται)', included: false },
  { id: 'needs_review', label: 'Needs review (εξαιρείται μέχρι έλεγχο)', included: false },
];

const MATCH_FIELD_OPTIONS: Array<{ id: string; label: string; hint: string }> = [
  { id: 'orderName', label: 'Order Name / Increment ID', hint: 'π.χ. INTERCO-, B2B-, prefix στο order number' },
  { id: 'orderId', label: 'Order ID', hint: 'εσωτερικό numeric ID της παραγγελίας' },
  { id: 'customerEmail', label: 'Customer Email', hint: 'π.χ. @etennis-wholesale.gr' },
  { id: 'paymentMethod', label: 'Payment Method', hint: 'π.χ. skroutz, intercompany_credit' },
  { id: 'shippingMethod', label: 'Shipping Method', hint: 'π.χ. courier_b2b, internal_transfer' },
];

type EditableRule = EcommerceSalesChannelRule & {
  _draftId: string;
  patternsRaw: string;
};

function genId(): string {
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function ruleToEditable(rule: EcommerceSalesChannelRule): EditableRule {
  return {
    ...rule,
    _draftId: genId(),
    patternsRaw: (rule.patterns || []).join(', '),
    enabled: rule.enabled !== false,
    matchFields: rule.matchFields?.length ? rule.matchFields : ['orderName'],
    channel: rule.channel || 'intercompany',
  };
}

function editableToRule(r: EditableRule): EcommerceSalesChannelRule {
  const patterns = r.patternsRaw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    enabled: r.enabled !== false,
    channel: r.channel,
    includeInCoreRevenue: r.channel === 'direct_eshop',
    matchFields: r.matchFields?.length ? r.matchFields : ['orderName'],
    patterns,
  };
}

async function fetchRulesFromConnector(brandId: string): Promise<EcommerceSalesChannelRule[]> {
  const conn = await FirestoreService.getDocument<{
    ecommerceSalesChannelRules?: EcommerceSalesChannelRule[];
    salesChannelRules?: EcommerceSalesChannelRule[];
    magento?: { salesChannelRules?: EcommerceSalesChannelRule[] };
  }>('connectors', brandId);
  if (!conn) return [];
  const a = Array.isArray(conn.ecommerceSalesChannelRules) ? conn.ecommerceSalesChannelRules : [];
  const b = Array.isArray(conn.salesChannelRules) ? conn.salesChannelRules : [];
  const c = Array.isArray(conn.magento?.salesChannelRules) ? conn.magento!.salesChannelRules! : [];
  return [...a, ...b, ...c];
}

/** Stable σύγκριση για sync από server χωρίς να σβήνουμε drafts που γράφει ο χρήστης. */
function persistedSignature(rules: EcommerceSalesChannelRule[]): string {
  try {
    return JSON.stringify(
      rules.map((r) => ({
        e: r.enabled !== false,
        ch: r.channel || 'intercompany',
        p: (r.patterns || []).slice().sort(),
        m: [...(r.matchFields || []).slice()].sort(),
      }))
    );
  } catch {
    return String(rules.length);
  }
}

export function SalesChannelRulesEditor() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: persisted = [], isPending } = useQuery({
    queryKey: ['salesChannelRules', brandId],
    queryFn: () => (brandId ? fetchRulesFromConnector(brandId) : Promise.resolve([])),
    enabled: !!brandId,
    staleTime: 30 * 1000,
  });

  const [drafts, setDrafts] = useState<EditableRule[]>([]);
  const [saving, setSaving] = useState(false);
  const lastServerSigApplied = useRef<string>('');

  const dirty = useMemo(() => {
    if (drafts.length !== persisted.length) return true;
    return drafts.some((d, i) => {
      const orig = persisted[i];
      const c = editableToRule(d);
      return (
        c.enabled !== (orig.enabled !== false) ||
        c.channel !== (orig.channel || 'intercompany') ||
        c.patterns?.join(',') !== (orig.patterns || []).join(',') ||
        (c.matchFields || []).join(',') !== (orig.matchFields || []).join(',')
      );
    });
  }, [drafts, persisted]);

  /** Αλλαγή brand: μη δείξουμε κανόνες προηγούμενου brand μέχρι να φτάσουν τα δεδομένα. */
  useEffect(() => {
    lastServerSigApplied.current = '';
    setDrafts([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  /**
   * Όταν αλλάζει το περιεχόμενο του Firestore από React Query χωρίς ο χρήστης να επεξεργάζεται (dirty=false),
   * κρατάμε τα drafts ευθυγραμμισμένα. Αν dirty=true (ανοιχτές αλλαγές), τα refetch με το ίδιο signature
   * δεν πειράζουν τις πρόχειρες γραμμές.
   */
  useEffect(() => {
    const sig = persistedSignature(persisted);
    if (dirty) return;
    if (sig === lastServerSigApplied.current) return;
    lastServerSigApplied.current = sig;
    setDrafts(persisted.map(ruleToEditable));
  }, [persisted, dirty]);

  const addRule = () => {
    setDrafts((prev) => [
      ...prev,
      {
        _draftId: genId(),
        patternsRaw: '',
        enabled: true,
        channel: 'intercompany',
        includeInCoreRevenue: false,
        matchFields: ['orderName'],
      },
    ]);
  };

  const updateRule = useCallback(<K extends keyof EditableRule>(idx: number, key: K, value: EditableRule[K]) => {
    setDrafts((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  }, []);

  const removeRule = (idx: number) => setDrafts((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!brandId) return;
    const cleaned = drafts.map(editableToRule).filter((r) => (r.patterns?.length || 0) > 0);
    if (drafts.length > 0 && cleaned.length === 0) {
      toast.error(
        'Καμία γραμμή δεν έχει Patterns (κείμενο στο πεδίο patterns). Συμπλήρωσέ τα και ξανά Αποθήκευση — αλλιώς δεν αποθηκεύεται κανείς κανόνας.'
      );
      return;
    }
    setSaving(true);
    try {
      const ref = doc(db, 'connectors', brandId);
      await updateDoc(ref, {
        ecommerceSalesChannelRules: cleaned,
        salesChannelRules: deleteField(),
        'magento.salesChannelRules': deleteField(),
        updatedAt: Timestamp.now(),
      });
      lastServerSigApplied.current = persistedSignature(cleaned);
      queryClient.invalidateQueries({ queryKey: ['salesChannelRules', brandId] });
      queryClient.invalidateQueries({ queryKey: ['connectorsPanel', brandId], exact: false });
      queryClient.invalidateQueries({ queryKey: ['ecommerceOrdersRaw', brandId] });
      queryClient.invalidateQueries({ queryKey: ['ecommerce_summary', brandId] });
      toast.success(
        `Αποθηκεύτηκαν ${cleaned.length} κανόνες. Τρέξε «Sync» στο Magento ή περίμενε το nightly για re-aggregation στο server summary.`
      );
    } catch (err) {
      console.error('[SalesChannelRulesEditor] save failed:', err);
      toast.error('Αποτυχία αποθήκευσης κανόνων.');
    } finally {
      setSaving(false);
    }
  };

  if (!brandId) return null;

  return (
    <Card padding="lg">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-semibold text-[var(--nts-charcoal)]">Sales Channel Rules</h3>
            <Tooltip
              content="Κανόνες για να εξαιρεθούν παραγγελίες από τον τζίρο (π.χ. ενδοομιλικές B2B, Skroutz marketplace). Όταν ένα order ταιριάζει με κάποιο pattern, classified-εται στο αντίστοιχο κανάλι. Τα non-direct_eshop κανάλια εξαιρούνται από το «Σύνολο Εσόδων»."
              size={13}
            />
          </div>
          <p className="text-[12px] text-[var(--nts-medium-gray)] mt-1">
            {drafts.length === 0
              ? 'Δεν έχουν δηλωθεί κανόνες — όλες οι παραγγελίες μπαίνουν στο τζίρο.'
              : `${drafts.length} κανόνες (${drafts.filter((r) => r.enabled !== false).length} ενεργοί)`}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={addRule}>
          <Plus size={14} className="mr-1" />
          Νέος κανόνας
        </Button>
      </div>

      {isPending ? (
        <div className="flex items-center justify-center py-6">
          <Spinner />
        </div>
      ) : drafts.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-[var(--nts-border-gray)] rounded-lg">
          <p className="text-[13px] text-[var(--nts-medium-gray)]">
            Καμία εξαίρεση. Πρόσθεσε κανόνα π.χ. για να εξαιρέσεις ενδοομιλικά orders με prefix
            <code className="mx-1 px-1.5 py-0.5 bg-[var(--nts-light-gray)] rounded text-[11px]">INTERCO-</code>
            στο order number.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map((rule, idx) => (
            <div
              key={rule._draftId}
              className={[
                'p-3 rounded-lg border',
                rule.enabled !== false
                  ? 'bg-white border-[var(--nts-border-gray)]'
                  : 'bg-[var(--nts-light-gray)]/40 border-[var(--nts-border-gray)] opacity-70',
              ].join(' ')}
            >
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                {/* Channel */}
                <div className="md:col-span-3">
                  <label className="block text-[11px] font-medium text-[var(--nts-medium-gray)] mb-1">Κανάλι</label>
                  <select
                    value={rule.channel || 'intercompany'}
                    onChange={(e) => updateRule(idx, 'channel', e.target.value as EcommerceSalesChannel)}
                    className="w-full text-[13px] px-2 py-1.5 border border-[var(--nts-border-gray)] rounded-md bg-white"
                  >
                    {CHANNEL_OPTIONS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {SALES_CHANNEL_LABELS[c.id]} {c.included ? '✓' : '✕'}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Match field */}
                <div className="md:col-span-3">
                  <label className="block text-[11px] font-medium text-[var(--nts-medium-gray)] mb-1">
                    Match field
                  </label>
                  <select
                    value={rule.matchFields?.[0] || 'orderName'}
                    onChange={(e) => updateRule(idx, 'matchFields', [e.target.value])}
                    className="w-full text-[13px] px-2 py-1.5 border border-[var(--nts-border-gray)] rounded-md bg-white"
                  >
                    {MATCH_FIELD_OPTIONS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-[var(--nts-medium-gray)] mt-1 leading-tight">
                    {MATCH_FIELD_OPTIONS.find((f) => f.id === (rule.matchFields?.[0] || 'orderName'))?.hint}
                  </p>
                </div>

                {/* Patterns */}
                <div className="md:col-span-5">
                  <label className="block text-[11px] font-medium text-[var(--nts-medium-gray)] mb-1">
                    Patterns (comma-separated, case-insensitive substring match)
                  </label>
                  <input
                    type="text"
                    value={rule.patternsRaw}
                    onChange={(e) => updateRule(idx, 'patternsRaw', e.target.value)}
                    placeholder="INTERCO-, B2B-, @wholesale.gr"
                    className="w-full text-[13px] px-2 py-1.5 border border-[var(--nts-border-gray)] rounded-md bg-white"
                  />
                </div>

                {/* Toggle + Delete */}
                <div className="md:col-span-1 flex items-end justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => updateRule(idx, 'enabled', rule.enabled === false)}
                    title={rule.enabled !== false ? 'Απενεργοποίηση' : 'Ενεργοποίηση'}
                    className="p-1.5 rounded-md hover:bg-[var(--nts-light-gray)] text-[var(--nts-medium-gray)]"
                  >
                    <X size={14} className={rule.enabled === false ? 'opacity-100' : 'opacity-30'} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRule(idx)}
                    title="Διαγραφή"
                    className="p-1.5 rounded-md hover:bg-red-50 text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-[var(--nts-border-gray)]">
        {dirty && <span className="text-[11px] text-[var(--nts-medium-gray)]">Μη αποθηκευμένες αλλαγές</span>}
        <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={handleSave}>
          <Save size={14} className="mr-1" />
          {saving ? 'Αποθήκευση…' : 'Αποθήκευση'}
        </Button>
      </div>
    </Card>
  );
}
