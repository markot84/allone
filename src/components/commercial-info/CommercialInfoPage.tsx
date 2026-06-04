import { useState } from 'react';
import { Lightbulb, Plus, Archive, RotateCcw, Trash2, TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react';
import { Card, CardHeader, Button, Badge, PageHeader, Spinner } from '../common';
import { useCommercialInfo } from '../../hooks/useCommercialInfo';
import type {
  CommercialInfo,
  CommercialFactorType,
  CommercialDirection,
  CommercialMagnitude,
  CommercialConfidence,
} from '../../services/commercialInfo';

const FACTOR_LABEL: Record<CommercialFactorType, string> = {
  event: 'Γεγονός',
  trend: 'Τάση',
  pricing: 'Τιμολόγηση/Ακρίβεια',
  competition: 'Ανταγωνισμός',
  instinct: 'Ένστικτο',
  macro: 'Μακροοικονομικά',
};

const DIRECTION_LABEL: Record<CommercialDirection, string> = { up: 'Άνοδος', down: 'Πτώση', neutral: 'Ουδέτερο' };
const MAG_LABEL: Record<CommercialMagnitude, string> = { low: 'Χαμηλή', medium: 'Μέτρια', high: 'Υψηλή' };
const CONF_LABEL: Record<CommercialConfidence, string> = { low: 'Χαμηλή', medium: 'Μέτρια', high: 'Υψηλή' };

function DirectionIcon({ d }: { d: CommercialDirection }) {
  if (d === 'up') return <TrendingUp size={14} className="text-emerald-600" />;
  if (d === 'down') return <TrendingDown size={14} className="text-red-500" />;
  return <Minus size={14} className="text-gray-400" />;
}

function InfoCard({
  item,
  onArchive,
  onActivate,
  onDelete,
  busy,
}: {
  item: CommercialInfo;
  onArchive: () => void;
  onActivate: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const scope = [
    item.brands.length ? { label: 'Επωνυμίες', value: item.brands.join(', ') } : null,
    item.categories.length ? { label: 'Κατηγορίες', value: item.categories.join(', ') } : null,
    item.parentSkus.length ? { label: 'Parent SKU', value: item.parentSkus.join(', ') } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <Card className={item.status !== 'active' ? 'opacity-60' : ''}>
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <DirectionIcon d={item.direction} />
            <p className="text-sm font-semibold text-[var(--nts-charcoal)] leading-snug">{item.summary}</p>
          </div>
          {item.status !== 'active' && <Badge variant="default">Αρχειοθετημένη</Badge>}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="info">{FACTOR_LABEL[item.factorType]}</Badge>
          <Badge variant={item.direction === 'up' ? 'success' : item.direction === 'down' ? 'danger' : 'default'}>
            {DIRECTION_LABEL[item.direction]}
          </Badge>
          <Badge variant="default">Ένταση: {MAG_LABEL[item.magnitude]}</Badge>
          <Badge variant={item.confidence === 'high' ? 'success' : item.confidence === 'medium' ? 'info' : 'warning'}>
            Εμπιστοσύνη: {CONF_LABEL[item.confidence]}
          </Badge>
          {(item.horizonFrom || item.horizonTo) && (
            <Badge variant="default">
              {item.horizonFrom ?? '…'} → {item.horizonTo ?? '…'}
            </Badge>
          )}
          {(item.source === 'mark' || item.source === 'nilia') && <Badge variant="orange">από Mark</Badge>}
        </div>

        {scope.length > 0 && (
          <div className="text-xs text-[var(--nts-medium-gray)] space-y-0.5">
            {scope.map((s) => (
              <div key={s.label}>
                <span className="font-medium text-[var(--nts-charcoal)]">{s.label}:</span> {s.value}
              </div>
            ))}
          </div>
        )}

        {item.rawText && item.rawText !== item.summary && (
          <p className="text-xs text-[var(--nts-medium-gray)] italic border-l-2 border-[var(--nts-border-gray)] pl-2">
            «{item.rawText}»
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          {item.status === 'active' ? (
            <button
              onClick={onArchive}
              disabled={busy}
              className="text-xs flex items-center gap-1 text-[var(--nts-medium-gray)] hover:text-[var(--nts-charcoal)] disabled:opacity-50"
            >
              <Archive size={13} /> Αρχειοθέτηση
            </button>
          ) : (
            <button
              onClick={onActivate}
              disabled={busy}
              className="text-xs flex items-center gap-1 text-[var(--nts-accent)] hover:underline disabled:opacity-50"
            >
              <RotateCcw size={13} /> Επαναφορά
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={busy}
            className="text-xs flex items-center gap-1 text-red-500 hover:text-red-600 disabled:opacity-50"
          >
            <Trash2 size={13} /> Διαγραφή
          </button>
        </div>
      </div>
    </Card>
  );
}

export function CommercialInfoPage() {
  const { items, isLoading, brandId, brandName, addInfo, setStatus, removeInfo, structure } = useCommercialInfo();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingStep, setSavingStep] = useState<'structure' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = items.filter((i) => i.status === 'active');
  const archived = items.filter((i) => i.status !== 'active');

  const handleAdd = async () => {
    const raw = draft.trim();
    if (!raw || saving || !brandId) return;
    setSaving(true);
    setSavingStep('structure');
    setError(null);
    try {
      const structured = await structure(raw, { brandName });
      setSavingStep('save');
      await addInfo.mutateAsync({ rawText: raw, structured, source: 'owner' });
      setDraft('');
    } catch (e) {
      console.error('[CommercialInfo] add:', e);
      setError('Δεν ολοκληρώθηκε η καταχώρηση. Δοκίμασε ξανά σε λίγο.');
    } finally {
      setSaving(false);
      setSavingStep(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-[var(--nts-charcoal)] sm:text-2xl">
            <Lightbulb size={24} className="shrink-0 text-[var(--nts-accent)]" />
            Εμπορικές Πληροφορίες
          </h2>
        }
        description={
          <p className="text-[14px] text-[var(--nts-medium-gray)]">
            Κατέγραψε γνώση, εξελίξεις αγοράς ή το εμπορικό σου ένστικτο. Η εφαρμογή τα δομεί και ο Mark τα λαμβάνει υπόψη στο
            Marketing Plan, στις προβλέψεις πωλήσεων και στις προτάσεις πολιτικής.
          </p>
        }
      />

      {/* Composer */}
      <Card>
        <CardHeader title="Νέα εμπορική πληροφορία" />
        <div className="p-4 pt-0 space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="π.χ. «Roland Garros: νέος πρεσβευτής Adidas — αναμένω αυξημένη ζήτηση σε ρακέτες & ρούχα tennis Adidas τον Ιούνιο»"
            className="w-full px-3 py-2 border border-[var(--nts-border-gray)] rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)] resize-none"
            disabled={saving || !brandId}
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--nts-medium-gray)]">
              {savingStep === 'structure'
                ? 'Δομείται η πληροφορία σε κατηγορίες, επωνυμίες, κατεύθυνση και ορίζοντα…'
                : savingStep === 'save'
                  ? 'Αποθηκεύεται ώστε να χρησιμοποιηθεί από Mark και Marketing Plan…'
                  : 'Η εφαρμογή θα αναγνωρίσει κατηγορίες, parent SKU, επωνυμίες, κατεύθυνση και ορίζοντα.'}
            </p>
            <Button variant="primary" onClick={handleAdd} disabled={!draft.trim() || saving || !brandId} icon={saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}>
              {saving ? 'Καταχώριση…' : 'Καταχώριση'}
            </Button>
          </div>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          <div>
            <h3 className="text-sm font-semibold text-[var(--nts-charcoal)] mb-3">
              Ενεργές πληροφορίες ({active.length})
            </h3>
            {active.length === 0 ? (
              <Card>
                <div className="p-8 text-center text-sm text-[var(--nts-medium-gray)]">
                  Δεν υπάρχουν ενεργές εμπορικές πληροφορίες. Πρόσθεσε την πρώτη παραπάνω ή πες την στον Mark.
                </div>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {active.map((item) => (
                  <InfoCard
                    key={item.id}
                    item={item}
                    busy={setStatus.isPending || removeInfo.isPending}
                    onArchive={() => setStatus.mutate({ id: item.id, status: 'archived' })}
                    onActivate={() => setStatus.mutate({ id: item.id, status: 'active' })}
                    onDelete={() => removeInfo.mutate(item.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {archived.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--nts-medium-gray)] mb-3">
                Αρχείο ({archived.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {archived.map((item) => (
                  <InfoCard
                    key={item.id}
                    item={item}
                    busy={setStatus.isPending || removeInfo.isPending}
                    onArchive={() => setStatus.mutate({ id: item.id, status: 'archived' })}
                    onActivate={() => setStatus.mutate({ id: item.id, status: 'active' })}
                    onDelete={() => removeInfo.mutate(item.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default CommercialInfoPage;
