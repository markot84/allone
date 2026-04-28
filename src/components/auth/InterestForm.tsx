import { useState, type FormEvent } from 'react';
import { Send } from 'lucide-react';
import { Card, Button, Spinner, useToast } from '../common';
import { buildFunctionUrl } from '../../config/firebase';

/**
 * Dev: Vite proxy. Prod: απευθείας HTTP function (όχι μέσω Hosting — όριο ~60s στο proxy).
 */
function getSubmitInterestLeadUrl(): string {
  const override = import.meta.env.VITE_INTEREST_LEAD_URL as string | undefined;
  if (override?.trim()) return override.trim();
  if (import.meta.env.DEV) return '/api/submitInterestLead';
  return buildFunctionUrl('/submitInterestLead');
}

export function InterestForm() {
  const toast = useToast();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!consent) {
      toast.error('Για να συνεχίσετε, αποδεχτείτε την επεξεργασία των στοιχείων σας.');
      return;
    }
    setSending(true);
    try {
      const res = await fetch(getSubmitInterestLeadUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          phone,
          company,
          message,
          consent: true,
          hp,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      toast.success(
        'Η υποβολή ολοκληρώθηκε. Θα λάβετε επιβεβαίωση στο email σας και η ομάδα μας θα επικοινωνήσει σύντομα.'
      );
      setFullName('');
      setEmail('');
      setPhone('');
      setCompany('');
      setMessage('');
      setConsent(false);
      setHp('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || 'Αποτυχία αποστολής. Δοκιμάστε ξανά.');
    } finally {
      setSending(false);
    }
  };

  const inputClass =
    'w-full rounded-xl border border-[#1f2328]/15 bg-[var(--nts-bg-pure)] px-4 py-2.5 text-sm text-[var(--nts-charcoal)] placeholder:text-[var(--nts-medium-gray)] focus:border-[var(--nts-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]/30';

  return (
    <Card>
      <div className="p-6 md:p-8">
        <p className="text-[11px] font-semibold tracking-[0.08em] text-[var(--nts-accent)]">Εκδήλωση ενδιαφέροντος</p>
        <h3 className="mt-2 text-xl font-semibold text-[var(--nts-charcoal)]">Ενδιαφέρεστε για το Performance+;</h3>
        <p className="mt-1 text-sm text-[var(--nts-medium-gray)]">
          Συμπληρώστε τη φόρμα και η ομάδα μας θα επικοινωνήσει μαζί σας.
        </p>

        <form onSubmit={handleSubmit} className="relative mt-6 space-y-4">
          <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden>
            <label htmlFor="interest-hp">Website</label>
            <input
              id="interest-hp"
              name="hp"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={hp}
              onChange={(e) => setHp(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="interest-name" className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">
                Ονοματεπώνυμο <span className="text-red-600">*</span>
              </label>
              <input
                id="interest-name"
                className={inputClass}
                required
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                maxLength={120}
              />
            </div>
            <div>
              <label htmlFor="interest-email" className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">
                Email <span className="text-red-600">*</span>
              </label>
              <input
                id="interest-email"
                type="email"
                className={inputClass}
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={200}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="interest-phone" className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">
                Τηλέφωνο
              </label>
              <input
                id="interest-phone"
                type="tel"
                className={inputClass}
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={40}
              />
            </div>
            <div>
              <label htmlFor="interest-company" className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">
                Επωνυμία / εταιρεία
              </label>
              <input
                id="interest-company"
                className={inputClass}
                autoComplete="organization"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                maxLength={120}
              />
            </div>
          </div>

          <div>
            <label htmlFor="interest-message" className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">
              Μήνυμα
            </label>
            <textarea
              id="interest-message"
              className={`${inputClass} min-h-[100px] resize-y`}
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              placeholder="Περιγράψτε τις ανάγκες σας (προαιρετικό)"
            />
          </div>

          <label className="flex cursor-pointer items-start gap-3 text-sm text-[var(--nts-medium-gray)]">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 rounded border-[#1f2328]/25 text-[var(--nts-accent)] focus:ring-[var(--nts-accent)]"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              Έχω ενημερωθεί ότι τα στοιχεία μου θα χρησιμοποιηθούν αποκλειστικά για επικοινωνία σχετικά με το Performance+, σύμφωνα με την{' '}
              <a href="/privacy" className="text-[var(--nts-accent)] underline underline-offset-2">
                Πολιτική Απορρήτου
              </a>
              . <span className="text-red-600">*</span>
            </span>
          </label>

          <Button type="submit" variant="primary" disabled={sending} className="w-full sm:w-auto">
            {sending ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Αποστολή…
              </>
            ) : (
              <>
                <Send size={16} className="mr-2 inline" />
                Υποβολή
              </>
            )}
          </Button>
        </form>
      </div>
    </Card>
  );
}
