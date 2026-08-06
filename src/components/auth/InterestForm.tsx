import { useState, type FormEvent } from 'react';
import { Send } from 'lucide-react';
import { Card, Button, Spinner, useToast } from '../common';
import { buildFunctionUrl } from '../../config/firebase';
import { trackMarketingEvent, trackGoogleFormSubmitConversion, trackLinkedInConversion, trackMetaLead } from '../../utils/marketingTracking';

const improvementOptions = [
  'ROAS & budget allocation',
  'Stock clearance / slow movers',
  'Profitability & margin',
  'Product launches',
  'Connectors & data unification',
];

/** Dev: Vite proxy. Prod: direct HTTP function (not via Hosting — proxy has a ~60s limit). */
function getSubmitInterestLeadUrl(): string {
  const override = (import.meta.env.VITE_INTEREST_LEAD_URL as string | undefined)?.trim();
  if (override) return override;
  if (import.meta.env.DEV) return '/api/submitInterestLead';
  return buildFunctionUrl('/submitInterestLead');
}

export function InterestForm() {
  const toast = useToast();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [improvementFocus, setImprovementFocus] = useState('');
  const [message, setMessage] = useState('');
  const [hp, setHp] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    trackMarketingEvent('interest_form_submit', {
      improvement_focus: improvementFocus || 'not_selected',
    });
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 25_000);
      const messageWithIntent = [
        improvementFocus ? `Τι θέλει να βελτιώσει: ${improvementFocus}` : '',
        message,
      ].filter(Boolean).join('\n\n');
      const res = await fetch(
        getSubmitInterestLeadUrl(),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            fullName,
            email,
            phone,
            company,
            message: messageWithIntent,
            consent: true,
            hp,
          }),
        }
      );
      window.clearTimeout(timeout);
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Conversions only on a successful submit (a real lead).
      trackMetaLead();
      trackGoogleFormSubmitConversion();
      trackLinkedInConversion();
      toast.success(
        'Η υποβολή ολοκληρώθηκε. Θα επικοινωνήσουμε σύντομα.'
      );
      setFullName('');
      setEmail('');
      setPhone('');
      setCompany('');
      setImprovementFocus('');
      setMessage('');
      setHp('');
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'AbortError'
        ? 'Η αποστολή καθυστέρησε. Δοκιμάστε ξανά ή επικοινωνήστε με support@notthesame.gr.'
        : err instanceof Error ? err.message : String(err);
      toast.error(msg || 'Αποτυχία αποστολής. Δοκιμάστε ξανά.');
    } finally {
      setSending(false);
    }
  };

  const inputClass =
    'w-full rounded-xl border border-[var(--text-primary)]/15 bg-[var(--nts-bg-pure)] px-4 py-2.5 text-sm text-[var(--nts-charcoal)] placeholder:text-[var(--nts-medium-gray)] focus:border-[var(--nts-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]/30';

  return (
    <Card padding="none" className="overflow-hidden border-[var(--text-primary)]/10 shadow-[0_24px_60px_rgba(16,24,40,0.12)]">
      <div className="grid lg:grid-cols-[0.8fr_1.2fr]">
        <div className="relative overflow-hidden bg-[var(--text-primary)] p-6 text-white md:p-8">
          <div className="pointer-events-none absolute right-[-100px] top-[-100px] h-64 w-64 rounded-full bg-[var(--nts-accent)]/25 blur-3xl" />
          <div className="relative">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--nts-accent-text)]">Demo request</p>
            <h3 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-white">Δείτε πώς μπορεί να δουλέψει στο δικό σας e-shop</h3>
            <p className="mt-4 text-sm leading-7 text-white/70">
              Συμπληρώστε τη φόρμα και η ομάδα μας θα επικοινωνήσει μαζί σας για μια στρατηγική παρουσίαση της πλατφόρμας.
            </p>
            <div className="mt-6 grid gap-3 text-sm text-white/78">
              {['Εμπορική χαρτογράφηση αναγκών', 'Σύνδεση με τα υπάρχοντα κανάλια σας', 'Προτεινόμενα πρώτα use cases'].map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[var(--nts-accent)]" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="relative space-y-4 p-6 md:p-8">
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

          <div>
            <p className="mb-2 block text-xs font-medium text-[var(--nts-charcoal)]">
              Τι θέλετε να βελτιώσετε;
            </p>
            <div className="flex flex-wrap gap-2">
              {improvementOptions.map((option) => {
                const selected = improvementFocus === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      const next = selected ? '' : option;
                      setImprovementFocus(next);
                      trackMarketingEvent('interest_focus_select', {
                        improvement_focus: next || 'cleared',
                      });
                    }}
                    className={[
                      'rounded-full border px-3 py-2 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nts-accent)]',
                      selected
                        ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)] text-white shadow-[0_8px_18px_rgba(249,115,22,0.22)]'
                        : 'border-[var(--text-primary)]/10 bg-[var(--nts-bg-subtle)] text-[var(--nts-charcoal)] hover:border-[var(--nts-accent)]/40',
                    ].join(' ')}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
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
                Επωνυμία / Εταιρεία
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
              Μήνυμα (προαιρετικό)
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
