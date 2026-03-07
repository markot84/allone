import { useRef } from 'react';
import { ArrowRight, BarChart3, Brain, Database, FileSpreadsheet, HelpCircle, ShieldCheck, Target, Upload } from 'lucide-react';

type LandingVariant = 'ceo' | 'ops';

interface MarketingIndexPageProps {
  onOpenAuth: () => void;
  variant?: LandingVariant;
  onVariantChange?: (variant: LandingVariant) => void;
}

// ─── Static data ─────────────────────────────────────────────────────────────

const dataSources = [
  { name: 'ERP / Πωλήσεις', description: 'Προϊόντα, απόθεμα, τιμολόγηση, πελατολόγιο', icon: <Database size={18} /> },
  { name: 'Google Ads', description: 'Campaigns, κόστος, conversions, κοινά', icon: <BarChart3 size={18} /> },
  { name: 'Meta Ads', description: 'Campaigns, audiences, attribution', icon: <Target size={18} /> },
  { name: 'CSV / Excel', description: 'Segments, οικονομικά, analytics, custom data', icon: <FileSpreadsheet size={18} /> },
  { name: 'Data Import', description: 'Αυτόματη ή manual εισαγωγή αρχείων δεδομένων', icon: <Upload size={18} /> },
];

const inputOutputChain = {
  inputs: [
    'Transactional & inventory data (ERP)',
    'Campaign performance & attribution (Google Ads, Meta)',
    'Financial, CRM & custom datasets (CSV / manual)',
  ],
  outputs: [
    'Audience segmentation & commercial prioritization',
    'Portfolio scoring & decision signals',
    'Channel mix optimization & budget allocation',
    'Content strategy aligned with business objectives',
  ],
};


const problemsBeforeAfter = [
  {
    before: 'Αποσπασματικά reports, ασύνδετα εργαλεία και αργή μετάβαση από την πληροφορία στην απόφαση.',
    after: 'Ένα ενιαίο AI-powered σύστημα που μετατρέπει τα δεδομένα σε καθαρή στρατηγική εικόνα και εφαρμόσιμη καθοδήγηση.',
  },
  {
    before: 'Κατανομή προϋπολογισμού χωρίς τεκμηριωμένη αποτίμηση της απόδοσης ανά κανάλι ή πρωτοβουλία.',
    after: 'Σαφές πλαίσιο ROI attribution και εμπορικού πλαισίου αναφορών, ώστε να είναι σαφές τι αποδίδει, τι αναστέλλεται και τι κλιμακώνεται.',
  },
  {
    before: 'Εκτέλεση ενεργειών marketing χωρίς κοινό στρατηγικό πλαίσιο μεταξύ διοίκησης, ομάδων και συνεργατών.',
    after: 'Κοινό σύστημα αποφάσεων που ευθυγραμμίζει διοίκηση, εσωτερικά τμήματα και εξωτερικούς συνεργάτες.',
  },
];


const appPreviewPoints = [
  {
    title: 'Dashboard',
    featureLabel: 'Dashboard',
    problem: 'Πρόβλημα: Η διοίκηση δεν διαθέτει ενιαία και αξιόπιστη εικόνα για την εμπορική πορεία της επιχείρησης.',
    solution: 'Πώς το κάνει: Ενοποιεί KPIs, στρατηγικές προτεραιότητες και κρίσιμα εμπορικά σήματα σε κοινό πίνακα εποπτείας.',
    value: 'Υπεραξία: Υποστηρίζει ταχύτερη και περισσότερο τεκμηριωμένη λήψη αποφάσεων με κοινό σημείο αναφοράς για διοίκηση και τμήματα.',
    imageSrc: '/landing-screens/dashboard.png',
    imageClassName: 'object-left-top',
  },
  {
    title: 'Commercial Strategy',
    featureLabel: 'Commercial Strategy',
    problem: 'Πρόβλημα: Η ιεράρχηση προϊόντων και καναλιών γίνεται συχνά αποσπασματικά, χωρίς σταθερό διοικητικό πλαίσιο αξιολόγησης.',
    solution: 'Πώς το κάνει: Επιτρέπει τη ρύθμιση στρατηγικών βαρύτητων και την πολυπαραγονική αποτίμηση κάθε επιλογής με κοινή λογική.',
    value: 'Υπεραξία: Ο προϋπολογισμός κατευθύνεται προς κινήσεις με τη μεγαλύτερη δυνητική συμβολή σε ανάπτυξη, απόδοση και περιθώριο κέρδους.',
    imageSrc: '/landing-screens/strategy-rfm.png',
    imageClassName: 'object-top',
  },
  {
    title: 'Data Analysis',
    featureLabel: 'Data Analysis',
    problem: 'Πρόβλημα: Το marketing στοχεύει οριζόντια χωρίς επαρκή διαχωρισμό πελατών, προτεραιοτήτων και δυνητικής αξίας.',
    solution: 'Πώς το κάνει: Συνδυάζει RFM, συμπεριφορική και firmographic ανάλυση για ακριβέστερο segmentation και ιεράρχηση κοινού.',
    value: 'Υπεραξία: Οι καμπάνιες αποκτούν υψηλότερη ακρίβεια στόχευσης, αυξημένη πιθανότητα μετατροπής και ισχυρότερη εμπορική αποδοτικότητα.',
    imageSrc: '/landing-screens/strategy-rfm.png',
    imageClassName: 'object-bottom',
  },
  {
    title: 'Product Intelligence',
    featureLabel: 'Product Intelligence',
    problem: 'Πρόβλημα: Το προϊοντικό χαρτοφυλάκιο αξιολογείται αποσπασματικά, χωρίς σαφή εικόνα για ευκαιρίες, αδυναμίες και προτεραιότητες.',
    solution: 'Πώς το κάνει: Εντάσσει τα προϊόντα σε ενιαίο πλαίσιο αξιολόγησης με εμπορικά σήματα, απόδοση και επόμενες προτεραιότητες ανάπτυξης.',
    value: 'Υπεραξία: Γίνεται σαφές ποια προϊόντα πρέπει να ενισχυθούν, ποια να προστατευθούν και ποια να επανατοποθετηθούν με επιχειρηματική λογική.',
    imageSrc: '/landing-screens/dashboard.png',
    imageClassName: 'object-center',
  },
  {
    title: 'Content Strategy',
    featureLabel: 'Content Strategy',
    problem: 'Πρόβλημα: Ο σχεδιασμός περιεχομένου εκτελείται χωρίς σαφή σύνδεση με κοινά, στόχους και εμπορικές επιδιώξεις.',
    solution: 'Πώς το κάνει: Μετατρέπει audience insights, επιχειρηματικές προτεραιότητες και AI-powered σήματα σε σαφείς θεματικές κατευθύνσεις.',
    value: 'Υπεραξία: Το περιεχόμενο παύει να είναι αποσπασματικό και ευθυγραμμίζεται άμεσα με engagement, ζήτηση και μετατροπές.',
    imageSrc: '/landing-screens/strategy-rfm.png',
    imageClassName: 'object-center',
  },
];

const variantCopy: Record<LandingVariant, {
  badge: string; headline: string; highlight: string;
  description: string; cta: string; uspTitle: string; uspPoints: string[];
  uspFooter: string; finalTitle: string; finalDescription: string;
}> = {
  ceo: {
    badge: 'AI-powered operating layer για εμπορικές αποφάσεις',
    headline: 'Performance+',
    highlight: 'λειτουργικό σύστημα επιχειρηματικής ανάπτυξης',
    description: 'Αναλύει δεδομένα κοινού και αποθέματος, μετατρέπει την πληροφορία σε επιχειρηματική νοημοσύνη και προτείνει σενάρια εμπορικής πολιτικής, κατάλληλα προωθητικά κανάλια και οργανικό περιεχόμενο. Παράλληλα, συντονίζει τα εσωτερικά τμήματα και τους εξωτερικούς συνεργάτες, μειώνοντας τον κατακερματισμό της πληροφορίας και τις καθυστερήσεις που επιβραδύνουν την ανάπτυξη.',
    cta: 'Είσοδος στο Performance+',
    uspTitle: 'Γιατί ξεχωρίζει',
    uspPoints: [
      'Μετατρέπει τα εμπορικά δεδομένα σε διοικητική καθοδήγηση προσανατολισμένη στον εκάστοτε στρατηγικό στόχο, κερδοφορία, εκκαθάριση αποθέματος, λανσάρισμα ή αύξηση τζίρου.',
      'Συνδέει segmentation, προϊόντα, κανάλια και προτεραιότητες σε ενιαία λογική αξιολόγησης.',
      'Καθιστά την επίδραση μετρήσιμη μέσω ROI Attribution και AI-powered αναλυτικών συμπερασμάτων.',
    ],
    uspFooter: 'Απευθύνεται σε επιχειρηματίες και διευθυντικά στελέχη που χρειάζονται ένα κοινό σύστημα αποφάσεων για τα εσωτερικά τμήματα και τους εξωτερικούς συνεργάτες της επιχείρησής τους.',
    finalTitle: 'Έτοιμο για οργανισμούς που απαιτούν καθαρή λογική αποφάσεων',
    finalDescription: 'Όταν η επιχείρηση χρειάζεται AI-powered εμπορική νοημοσύνη, συστηματική διακυβέρνηση του marketing και σαφή σύνδεση της απόδοσης με τα έσοδα, το Performance+ λειτουργεί ως ενιαίο λειτουργικό σύστημα εμπορικής ανάπτυξης.',
  },
  ops: {
    badge: 'AI-powered operating layer για στρατηγική εκτέλεση',
    headline: 'Performance+',
    highlight: 'λειτουργικό σύστημα επιχειρηματικής ανάπτυξης',
    description: 'Αναλύει δεδομένα κοινού και αποθέματος, μετατρέπει την πληροφορία σε επιχειρηματική νοημοσύνη και προτείνει σενάρια εμπορικής πολιτικής, κατάλληλα προωθητικά κανάλια και οργανικό περιεχόμενο. Παράλληλα, συντονίζει τα εσωτερικά τμήματα και τους εξωτερικούς συνεργάτες, μειώνοντας τον κατακερματισμό της πληροφορίας και τις καθυστερήσεις που επιβραδύνουν την ανάπτυξη.',
    cta: 'Είσοδος στο Performance+',
    uspTitle: 'Γιατί το επιλέγουν τα τμήματα marketing και εμπορικής διεύθυνσης',
    uspPoints: [
      'Μειώνει τον χρόνο από την ανάλυση έως την εκτέλεση με σαφείς, εφαρμόσιμες και AI-powered προτάσεις.',
      'Ευθυγραμμίζει καμπάνιες, περιεχόμενο και προϋπολογισμό σε κοινό πλαίσιο δεικτών απόδοσης.',
      'Υποστηρίζει σταθερό κύκλο βελτιστοποίησης με καθαρά insights ανά κοινό, προϊόν και προτεραιότητα.',
    ],
    uspFooter: 'Λειτουργεί ως κοινό σύστημα αναφοράς για τα τμήματα που σχεδιάζουν, εγκρίνουν και εκτελούν την εμπορική στρατηγική.',
    finalTitle: 'Το λειτουργικό υπόβαθρο του marketing και του εμπορικού σχεδιασμού',
    finalDescription: 'Για τμήματα που διαχειρίζονται πολλαπλά κανάλια και αυξημένη επιχειρησιακή πολυπλοκότητα, το Performance+ προσφέρει κοινή ορατότητα, AI-powered καθοδήγηση και συνεχή βελτιστοποίηση της απόδοσης.',
  },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function isPreviewDarkHighlight(index: number) {
  return index === 1 || index === 3;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function MarketingIndexPage({ onOpenAuth, variant = 'ceo', onVariantChange: _onVariantChange }: MarketingIndexPageProps) {
  const copy = variantCopy[variant];
  void _onVariantChange;

  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={scrollRef} className="h-screen overflow-y-auto overflow-x-hidden bg-[var(--nts-bg-subtle)] text-[var(--nts-charcoal)]">

      {/* ── Sticky header ────────────────────────────────────────────────── */}
      <header className="relative z-20">
        <div className="mx-auto w-full max-w-7xl px-6 pt-5 md:px-10">
          <div className="rounded-[22px] border border-[#1f2328]/10 bg-[var(--nts-bg-pure)] px-4 py-3 shadow-[0_10px_24px_rgba(16,24,40,0.08)] md:px-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl">
                  <img src="/nts-icon.png" alt="Performance+" className="h-8 w-8 object-contain" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-[var(--nts-medium-gray)]">{copy.badge}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={onOpenAuth}
                className="rounded-xl border border-[var(--nts-accent-hover)] bg-[var(--nts-accent)] px-4 py-2 text-sm font-semibold text-white shadow-[0_6px_14px_rgba(249,115,22,0.35)] transition hover:bg-[var(--nts-accent-hover)]"
              >
                Είσοδος
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-6 pb-8 pt-5 md:px-10 md:pt-7">
        <div className="relative overflow-hidden rounded-[36px] border border-[#1f2328]/10 bg-[var(--nts-bg-pure)] px-6 py-8 shadow-[0_24px_56px_rgba(16,24,40,0.12)] md:px-8 md:py-10">
          <div className="pointer-events-none absolute right-[-80px] top-[-20px] h-64 w-64 rounded-full bg-[var(--nts-accent)]/12 blur-3xl" />
          <div className="pointer-events-none absolute bottom-[-100px] left-[-20px] h-72 w-72 rounded-full bg-[#1f2328]/4 blur-3xl" />

          <div className="relative">
            <div className="space-y-8">
              <div className="space-y-5">
                <h1 className="max-w-4xl leading-[1.04] text-[var(--nts-charcoal)]">
                  <span className="block text-4xl font-bold md:text-6xl">{copy.headline}</span>
                  {copy.highlight && (
                    <span className="mt-2 block text-2xl font-semibold text-[var(--nts-accent)] md:text-4xl">{copy.highlight}</span>
                  )}
                </h1>
                <p className="max-w-2xl text-[15px] leading-7 text-[var(--nts-medium-gray)] md:text-base">
                  {copy.description}
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {[
                  'Διοικητική εικόνα για έσοδα, περιθώρια κέρδους και εμπορικό ρίσκο.',
                  'AI-powered προτεραιότητες για προϊόντα, κοινά, κανάλια και επένδυση.',
                  'Κοινό πλαίσιο εκτέλεσης για management, marketing και εξωτερικούς συνεργάτες.'
                ].map((point) => (
                  <div key={point} className="rounded-2xl border border-white/10 bg-[#12151b] p-4.5 shadow-[0_10px_24px_rgba(15,17,21,0.18)]">
                    <div className="mb-3 h-1.5 w-10 rounded-full bg-[var(--nts-accent)]" />
                    <p className="text-sm leading-6 text-white/76">{point}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="inline-flex items-center gap-2 rounded-xl bg-[var(--nts-accent)] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(249,115,22,0.35)] transition hover:bg-[var(--nts-accent-hover)]"
                >
                  {copy.cta}
                  <ArrowRight size={16} />
                </button>
                <a
                  href="mailto:hello@notthesame.ai?subject=Performance%2B%20Demo%20Request"
                  className="inline-flex items-center gap-2 rounded-xl border border-[#1f2328]/10 bg-[var(--nts-bg-subtle)] px-5 py-3 text-sm font-semibold text-[var(--nts-charcoal)] transition hover:bg-[var(--nts-light-gray)]"
                >
                  <HelpCircle size={16} />
                  Ζήτησε demo
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Data Sources + Input/Output ─────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)]">
          <p className="text-[11px] tracking-[0.08em] text-[var(--nts-accent)]">Data Input → Intelligence Output</p>
          <h3 className="mt-2 text-lg font-semibold text-[var(--nts-charcoal)]">Ενοποίηση δεδομένων από πολλαπλές πηγές σε ενιαίο περιβάλλον αποφάσεων</h3>

          <div className="mt-5 grid gap-3 md:grid-cols-5">
            {dataSources.map((source) => (
              <div key={source.name} className="rounded-xl border border-[#1f2328]/12 bg-[var(--nts-bg-subtle)] p-4 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-[#1f2328]/10 bg-[var(--nts-bg-pure)] text-[var(--nts-charcoal)]">
                  {source.icon}
                </div>
                <p className="mt-3 text-sm font-semibold text-[var(--nts-charcoal)]">{source.name}</p>
                <p className="mt-1 text-xs text-[var(--nts-medium-gray)]">{source.description}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto_1fr]">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-[var(--nts-medium-gray)]">Data Input</p>
              {inputOutputChain.inputs.map((item) => (
                <div key={item} className="rounded-xl border border-[#1f2328]/12 bg-[var(--nts-bg-subtle)] px-4 py-3 text-sm text-[var(--nts-charcoal)]">
                  {item}
                </div>
              ))}
            </div>

            <div className="hidden items-center justify-center md:flex">
              <div className="flex flex-col items-center gap-2">
                <div className="h-12 w-px bg-[var(--nts-accent)]/40" />
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--nts-accent)] text-white shadow-[0_6px_14px_rgba(249,115,22,0.35)]">
                  <ArrowRight size={16} />
                </div>
                <p className="text-[10px] font-semibold tracking-[0.08em] text-[var(--nts-accent)]">AI</p>
                <div className="h-12 w-px bg-[var(--nts-accent)]/40" />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-[var(--nts-accent)]">Intelligence Output</p>
              {inputOutputChain.outputs.map((item) => (
                <div key={item} className="rounded-xl border border-white/10 bg-[#12151b] px-4 py-3 text-sm text-white/80">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="grid items-stretch gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[28px] border border-[#1f2328]/10 bg-[var(--nts-bg-pure)] p-6 shadow-[0_18px_40px_rgba(16,24,40,0.12)]">
            <p className="text-[11px] tracking-[0.08em] text-[var(--nts-accent)]">Διοικητική Επισκόπηση</p>
            <h2 className="mt-4 max-w-2xl text-xl font-semibold leading-tight text-[var(--nts-charcoal)]">
              Το λειτουργικό σύστημα που μετατρέπει δεδομένα σε επιχειρηματική νοημοσύνη, άμεση και αποδοτική λήψη αποφάσεων με συντονισμένο πλάνο ενεργειών.
            </h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-[#12151b] p-5 shadow-[0_10px_24px_rgba(15,17,21,0.16)]">
                <p className="text-[11px] tracking-[0.08em] text-[var(--nts-accent)]">Εποπτεία</p>
                <p className="mt-2 text-2xl font-semibold text-white">360°</p>
                <p className="mt-2 text-sm leading-6 text-white/68">Κρίσιμα δεδομένα, προϊόντα, κοινά και κανάλια συγκεντρώνονται σε ένα ενιαίο πεδίο διοικητικής αναφοράς.</p>
              </div>
              <div className="rounded-2xl border border-[var(--nts-accent)]/30 bg-[#181c24] p-5 shadow-[0_10px_24px_rgba(15,17,21,0.16)]">
                <p className="text-[11px] tracking-[0.08em] text-[var(--nts-accent)]">Απόδοση</p>
                <p className="mt-2 text-2xl font-semibold text-white">Προτεραιότητα στο ROI</p>
                <p className="mt-2 text-sm leading-6 text-white/72">Ο προϋπολογισμός αποκτά σαφή λογική κατανομής και πλαίσιο ενεργειών με βάση την πραγματική απόδοση.</p>
              </div>
            </div>
          </div>

          <div className="rounded-[26px] border border-[#1f2328]/10 bg-[#12151b] p-6 shadow-[0_18px_40px_rgba(15,17,21,0.18)]">
              <p className="text-[11px] tracking-[0.08em] text-[var(--nts-accent)]">{copy.uspTitle}</p>
              <ul className="mt-4 space-y-3">
                {copy.uspPoints.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-sm leading-6 text-white/76">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--nts-accent)]" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
          </div>
        </div>
      </section>

      {/* ── Before / After problems ──────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)]">
            <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">Ποια προβλήματα επιλύει το Performance+</h3>

          {/* column headers */}
          <div className="mt-5 grid grid-cols-[1fr_1fr] gap-3 md:grid-cols-[auto_1fr_1fr]">
            <div className="hidden md:block" />
            <p className="rounded-t-xl bg-[var(--nts-light-gray)] px-4 py-2 text-center text-xs font-semibold tracking-[0.08em] text-[var(--nts-medium-gray)]">Χωρίς το Performance+</p>
            <p className="rounded-t-xl bg-[var(--nts-accent)] px-4 py-2 text-center text-xs font-semibold tracking-[0.08em] text-white">Με το Performance+</p>
          </div>

          <div className="space-y-2">
            {problemsBeforeAfter.map((item, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr] gap-3 md:grid-cols-[auto_1fr_1fr]">
                <div className="hidden items-center md:flex">
                  <span className="text-xs font-bold text-[#1f2328]/40">{String(i + 1).padStart(2, '0')}</span>
                </div>
                <div className="rounded-xl border border-[#1f2328]/15 bg-[var(--nts-light-gray)] px-4 py-3 text-sm text-[var(--nts-medium-gray)] line-through decoration-[#1f2328]/25">
                  {item.before}
                </div>
                <div className="rounded-xl border border-[var(--nts-accent)]/30 bg-[var(--nts-accent)]/6 px-4 py-3 text-sm font-medium text-[var(--nts-charcoal)]">
                  {item.after}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── App previews ──────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)]">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">5 σημεία από το ίδιο το περιβάλλον της εφαρμογής</h3>
          <p className="mt-2 text-sm text-[var(--nts-medium-gray)]">
            Πραγματικές οθόνες της εφαρμογής που δείχνουν πώς το Performance+ μετατρέπει δεδομένα και νοημοσύνη σε στοχευμένη εμπορική δράση.
          </p>

          <div className="mt-6 grid gap-6">
            {appPreviewPoints.map((point, index) => (
              <article
                key={point.title}
                className={[
                  'relative overflow-hidden rounded-[30px] border p-5 shadow-[0_14px_32px_rgba(16,24,40,0.12)]',
                  isPreviewDarkHighlight(index)
                    ? 'border-white/10 bg-[#101319] text-white'
                    : 'border-[#1f2328]/15 bg-[var(--nts-bg-pure)] text-[var(--nts-charcoal)]'
                ].join(' ')}
              >
                <div className="pointer-events-none absolute left-0 top-0 h-1 w-full bg-[var(--nts-accent)]" />
                <div className="pointer-events-none absolute bottom-0 left-0 h-1 w-full bg-[var(--nts-accent)]" />
                <div className={`grid items-center gap-6 lg:grid-cols-[0.86fr_1.14fr] ${index % 2 === 1 ? 'lg:grid-cols-[1.14fr_0.86fr]' : ''}`}>
                  <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                    <div>
                      {point.featureLabel !== point.title && (
                        <div className="inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.08em] border-current/10 bg-current/5 text-inherit">
                          {point.featureLabel}
                        </div>
                      )}
                      <h4 className={isPreviewDarkHighlight(index) ? 'mt-4 text-3xl font-semibold text-white' : 'mt-4 text-3xl font-semibold text-[var(--nts-charcoal)]'}>
                        {point.title}
                      </h4>
                      <p className={isPreviewDarkHighlight(index) ? 'mt-4 text-sm leading-7 text-white/68' : 'mt-4 text-sm leading-7 text-[var(--nts-medium-gray)]'}>
                        {point.problem}
                      </p>
                      <p className={isPreviewDarkHighlight(index) ? 'mt-3 text-sm leading-7 text-white/68' : 'mt-3 text-sm leading-7 text-[var(--nts-medium-gray)]'}>
                        {point.solution}
                      </p>
                    </div>

                    <div className={isPreviewDarkHighlight(index) ? 'mt-6 rounded-2xl border border-white/10 bg-white/6 p-4 text-sm font-medium text-white' : 'mt-6 rounded-2xl border border-[#1f2328]/10 bg-[var(--nts-bg-subtle)] p-4 text-sm font-medium text-[var(--nts-charcoal)]'}>
                      {point.value}
                    </div>
                  </div>

                  <div className={index % 2 === 1 ? 'lg:order-1' : ''}>
                    <div className="relative overflow-hidden rounded-[26px] border border-[#1f2328]/15 bg-[var(--nts-light-gray)]">
                      <img
                        src={point.imageSrc}
                        alt={`${point.title} screenshot`}
                        className={`h-[360px] w-full object-cover lg:h-[420px] ${point.imageClassName}`}
                      />
                      <div className="pointer-events-none absolute left-0 top-0 h-10 w-full bg-[var(--nts-bg-pure)]/86 backdrop-blur-[2px]" />
                      <div className="pointer-events-none absolute left-0 top-0 h-full w-14 bg-[var(--nts-bg-pure)]/76 backdrop-blur-[1px]" />
                      <div className="pointer-events-none absolute right-3 top-3 h-6 w-28 rounded-full bg-[var(--nts-bg-pure)]/92" />
                      <div className="pointer-events-none absolute left-3 top-3 h-6 w-24 rounded-full bg-[var(--nts-bg-pure)]/92" />
                      <div className="pointer-events-none absolute bottom-4 left-4 rounded-full bg-[#0f1115]/86 px-3 py-1.5 text-[11px] font-semibold tracking-[0.08em] text-white backdrop-blur">
                        Ζωντανή απεικόνιση προϊόντος
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>


      {/* ── Final CTA ─────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)]">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">{copy.finalTitle}</h3>
          <p className="mt-2 max-w-3xl text-sm text-[var(--nts-medium-gray)]">{copy.finalDescription}</p>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onOpenAuth}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--nts-accent)] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(249,115,22,0.35)] transition hover:bg-[var(--nts-accent-hover)]"
            >
              Ενεργοποίηση χώρου εργασίας
              <ArrowRight size={16} />
            </button>
            <a
              href="mailto:hello@notthesame.ai?subject=Performance%2B%20Demo%20Request"
              className="inline-flex items-center gap-2 rounded-xl border border-[#1f2328] bg-[var(--nts-bg-pure)] px-5 py-3 text-sm font-semibold text-[#1f2328] transition hover:bg-[var(--nts-light-gray)]"
            >
              <HelpCircle size={16} />
              Ζήτησε παρουσίαση / επικοινωνία
            </a>
          </div>

          <p className="mt-4 text-xs text-[var(--nts-medium-gray)]">
            Εναλλακτικά, επικοινώνησε στο <span className="font-semibold text-[var(--nts-charcoal)]">hello@notthesame.ai</span> για εταιρική ένταξη, εμπορική πολιτική ή εξειδικευμένη προσαρμογή του AI-powered περιβάλλοντος αποφάσεων.
          </p>
        </div>
      </section>

      {/* ── Compliance trust bar ─────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="flex flex-wrap items-center justify-center gap-6 rounded-2xl border border-[#1f2328]/10 bg-[var(--nts-bg-subtle)] px-6 py-4">
          {[
            { icon: <ShieldCheck size={15} />, text: 'GDPR-compliant' },
            { icon: <Brain size={15} />, text: 'EU AI Act — limited risk, transparent AI' },
            { icon: <Database size={15} />, text: 'Google Cloud / Firebase (EU region)' },
          ].map((item) => (
            <div key={item.text} className="flex items-center gap-2 text-xs text-[var(--nts-medium-gray)]">
              <span className="text-[var(--nts-charcoal)]">{item.icon}</span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer brand tag ──────────────────────────────────────────────── */}
      <footer className="mx-auto w-full max-w-7xl px-6 pb-10 pt-2 md:px-10">
        <div className="flex items-center justify-between border-t border-[#1f2328]/10 pt-5">
          <div className="flex items-center gap-2 text-xs text-[var(--nts-medium-gray)]">
            <Brain size={13} className="text-[#1f2328]" />
            <span>
              Performance+ powered by{' '}
              <a href="https://notthesame.gr" target="_blank" rel="noreferrer" className="font-semibold text-[var(--nts-charcoal)] hover:underline">
                notthesame.ai
              </a>
            </span>
          </div>
          <p className="text-xs text-[var(--nts-medium-gray)]">AI-powered πλατφόρμα εμπορικής και επιχειρησιακής νοημοσύνης</p>
        </div>
      </footer>

    </div>
  );
}
