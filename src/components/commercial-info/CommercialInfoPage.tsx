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
  pricing: 'Τιμές/Κόστη',
  competition: 'Ανταγωνισμός',
  instinct: 'Εμπειρική εκτίμηση',
  macro: 'Μακροοικονομικά',
};

const DIRECTION_LABEL: Record<CommercialDirection, string> = { up: 'Αυξητική επίδραση', down: 'Πτωτική επίδραση', neutral: 'Ουδέτερη επίδραση' };
const MAG_LABEL: Record<CommercialMagnitude, string> = { low: 'Χαμηλή', medium: 'Μέτρια', high: 'Υψηλή' };
const CONF_LABEL: Record<CommercialConfidence, string> = { low: 'Χαμηλή', medium: 'Μέτρια', high: 'Υψηλή' };

const FACTOR_HELP: Record<CommercialFactorType, string> = {
  event: 'Συμβάν ή περίοδος που μπορεί να αλλάξει προσωρινά τη ζήτηση.',
  trend: 'Μεταβολή στη συμπεριφορά της αγοράς ή των πελατών.',
  pricing: 'Πληροφορία για κόστος, ανατιμήσεις, εκπτώσεις ή πίεση τιμών.',
  competition: 'Κίνηση ανταγωνιστή που επηρεάζει positioning, budget ή προσφορές.',
  instinct: 'Εμπορική εκτίμηση από εμπειρία, πωλήσεις ή σήματα που δεν υπάρχουν ακόμη στα δεδομένα.',
  macro: 'Εξωτερικός παράγοντας όπως οικονομία, καιρός, κανονισμοί ή κοινωνική συγκυρία.',
};

const DIRECTION_HELP: Record<CommercialDirection, string> = {
  up: 'Περιμένουμε θετική επίδραση σε ζήτηση, έσοδα ή προτεραιότητα.',
  down: 'Περιμένουμε αρνητική πίεση ή ανάγκη προσοχής.',
  neutral: 'Η πληροφορία είναι χρήσιμο context, χωρίς καθαρή κατεύθυνση ακόμη.',
};

const MAG_HELP: Record<CommercialMagnitude, string> = {
  low: 'Μικρή επίδραση, κυρίως για monitoring.',
  medium: 'Αξίζει να ληφθεί υπόψη στο πλάνο και στις προτεραιότητες.',
  high: 'Πιθανή ισχυρή επίδραση, θέλει άμεση εμπορική προσοχή.',
};

const CONF_HELP: Record<CommercialConfidence, string> = {
  low: 'Υπόθεση ή πρώιμο σήμα.',
  medium: 'Υπάρχουν αρκετές ενδείξεις, αλλά θέλει επιβεβαίωση.',
  high: 'Ισχυρή πληροφορία ή πολύ αξιόπιστη εκτίμηση.',
};

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
          <Badge variant="default">Επίδραση: {MAG_LABEL[item.magnitude]}</Badge>
          <Badge variant={item.confidence === 'high' ? 'success' : item.confidence === 'medium' ? 'info' : 'warning'}>
            Βεβαιότητα: {CONF_LABEL[item.confidence]}
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

function CommercialInfoGuide() {
  return (
    <Card>
      <div className="grid gap-4 p-4 md:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-sm font-semibold text-[var(--nts-charcoal)]">Πώς θα αξιοποιηθεί</p>
          <p className="mt-1 text-sm leading-6 text-[var(--nts-medium-gray)]">
            Οι ενεργές πληροφορίες γίνονται εμπορικό context για το Marketing Plan, είτε το δημιουργήσεις από τη σελίδα του πλάνου είτε το συζητήσεις με τον Mark. Βοηθούν επίσης τις προτάσεις πολιτικής, προτεραιοποίησης καναλιών και ζήτησης να μη βασίζονται μόνο σε ιστορικά δεδομένα.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--nts-border-gray)] bg-white px-3 py-2">
              <p className="text-xs font-semibold text-[var(--nts-charcoal)]">1. Καταγραφή</p>
              <p className="mt-1 text-xs text-[var(--nts-medium-gray)]">Γράφεις ελεύθερα αυτό που ξέρεις ή υποψιάζεσαι.</p>
            </div>
            <div className="rounded-xl border border-[var(--nts-border-gray)] bg-white px-3 py-2">
              <p className="text-xs font-semibold text-[var(--nts-charcoal)]">2. Δόμηση</p>
              <p className="mt-1 text-xs text-[var(--nts-medium-gray)]">Η εφαρμογή εντοπίζει κατηγορία, brands, κατεύθυνση και ορίζοντα.</p>
            </div>
            <div className="rounded-xl border border-[var(--nts-border-gray)] bg-white px-3 py-2">
              <p className="text-xs font-semibold text-[var(--nts-charcoal)]">3. Χρήση</p>
              <p className="mt-1 text-xs text-[var(--nts-medium-gray)]">Το context μπαίνει στις προτάσεις, όχι ως απόλυτο δεδομένο.</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] p-3">
          <p className="text-sm font-semibold text-[var(--nts-charcoal)]">Τι σημαίνουν οι ετικέτες</p>
          <div className="mt-3 space-y-2 text-xs text-[var(--nts-medium-gray)]">
            <p><span className="font-semibold text-[var(--nts-charcoal)]">Τύπος</span>: π.χ. {FACTOR_LABEL.instinct} = {FACTOR_HELP.instinct}</p>
            <p><span className="font-semibold text-[var(--nts-charcoal)]">Κατεύθυνση</span>: {DIRECTION_HELP.up} Αν δεν είναι καθαρό, μπαίνει ως ουδέτερο context.</p>
            <p><span className="font-semibold text-[var(--nts-charcoal)]">Επίδραση</span>: {MAG_HELP.medium}</p>
            <p><span className="font-semibold text-[var(--nts-charcoal)]">Βεβαιότητα</span>: {CONF_HELP.low}</p>
          </div>
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
      const message = e instanceof Error && /permission|insufficient permissions/i.test(e.message)
        ? 'Δεν υπάρχει άδεια καταχώρησης για αυτό το brand. Ανανεώθηκε ο κανόνας ασφαλείας και χρειάζεται deploy.'
        : 'Δεν ολοκληρώθηκε η καταχώρηση. Δοκίμασε ξανά σε λίγο.';
      setError(message);
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
            Κατέγραψε πληροφορίες που δεν φαίνονται πάντα στα δεδομένα: αλλαγές αγοράς, κινήσεις ανταγωνισμού, ανατιμήσεις, εποχικότητα ή εμπορικές εκτιμήσεις. Η εφαρμογή τις δομεί και τις χρησιμοποιεί ως context στο Marketing Plan, στις προτάσεις πολιτικής και στις εκτιμήσεις ζήτησης.
          </p>
        }
      />

      <CommercialInfoGuide />

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
                ? 'Δομείται η πληροφορία σε τύπο, κατεύθυνση, επίδραση, βεβαιότητα και ορίζοντα…'
                : savingStep === 'save'
                  ? 'Αποθηκεύεται ώστε να χρησιμοποιηθεί από το Marketing Plan, τον Mark και τις προτάσεις πολιτικής…'
                  : 'Η εφαρμογή θα αναγνωρίσει τύπο πληροφορίας, κατηγορίες, επωνυμίες, κατεύθυνση, επίδραση και ορίζοντα.'}
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
