import { useRef } from 'react';
import { ArrowLeft, BarChart3, Brain, Database, ExternalLink, FileSpreadsheet, HelpCircle, Mail, ShieldCheck, Target, Upload } from 'lucide-react';
import { MARKETING_CONTACT_MAILTO } from '../../config/superAdmins';
import { InterestForm } from './InterestForm';
import { PerformancePlusLogo } from '../common';

type LandingVariant = 'ceo' | 'ops';

interface MarketingIndexPageProps {
  variant?: LandingVariant;
  onVariantChange?: (variant: LandingVariant) => void;
  /** Άνοιγμα οθόνης σύνδεσης (`?auth=1`) — για επισκέπτες landing */
  onOpenAuth?: () => void;
  /** Μόνο όταν ο χρήστης είναι ήδη συνδεδεμένος (π.χ. `?landing=1` preview) — ήπιο escape πίσω στο app */
  onReturnToApp?: () => void;
}

// ─── Static data ─────────────────────────────────────────────────────────────

const MARKETING_TAGLINE_HEADER = 'Η εμπορική νοημοσύνη του e-shop σας';

const heroParagraphs = [
  'Τα περισσότερα e-shops επενδύουν καθημερινά σε διαφήμιση χωρίς να γνωρίζουν ποια προϊόντα αξίζει πραγματικά να προωθήσουν.',
  'Άλλα προϊόντα εμφανίζονται σε καμπάνιες ενώ έχουν περιορισμένο απόθεμα. Άλλα μένουν για μήνες στην αποθήκη χωρίς εμπορική αξιοποίηση. Και συχνά το marketing λειτουργεί αποκομμένα από το stock, την κερδοφορία και τη συνολική εμπορική στρατηγική της επιχείρησης.',
  'Το Performance+ δημιουργήθηκε για να ενώσει όλα αυτά τα δεδομένα σε ένα ενιαίο σύστημα αποφάσεων.',
  'Συνδέει ERP, αποθέματα, πωλήσεις και διαφημιστικά κανάλια, μετατρέποντας την πληροφορία σε ξεκάθαρες εμπορικές προτάσεις για το τι πρέπει να προωθηθεί, πότε και με ποιο budget.',
  'Η ομάδα σας διατηρεί πάντα τον τελικό έλεγχο και τη στρατηγική κατεύθυνση. Το Performance+ λειτουργεί ως ένα intelligence layer που οργανώνει την πληροφορία, αναδεικνύει ευκαιρίες και βοηθά στη λήψη πιο αποδοτικών αποφάσεων.',
];

const dataIntroSources = [
  {
    name: 'ERP / Πωλήσεις',
    description: 'Συγχρονισμός προϊόντων, αποθέματος, τιμών και ιστορικού πελατών.',
    icon: <Database size={18} />,
  },
  {
    name: 'Google Ads',
    description: 'Δεδομένα καμπανιών, conversions, κόστος και απόδοση κοινού.',
    icon: <BarChart3 size={18} />,
  },
  {
    name: 'Meta Ads',
    description: 'Μετρήσεις αποτελεσμάτων, engagement και audience insights σε πραγματικό χρόνο.',
    icon: <Target size={18} />,
  },
  {
    name: 'CSV / Excel / Manual Import',
    description: 'Εισαγωγή custom δεδομένων, οικονομικών analytics και audience segments.',
    icon: <FileSpreadsheet size={18} />,
  },
];

const aiIntelligenceAxes = [
  {
    title: 'Segmentation κοινού & εμπορική ιεράρχηση',
    description: 'Ανάλυση πελατών με βάση την αξία, τη συμπεριφορά και τη δυναμική αγοράς.',
  },
  {
    title: 'Αξιολόγηση προϊοντικού χαρτοφυλακίου',
    description: 'Ανάδειξη ευκαιριών και πιθανών κινδύνων ανά SKU.',
  },
  {
    title: 'AI Channel Mix',
    description: 'Πρόταση κατανομής budget ανά κανάλι με βάση τον στόχο, το κοινό και την εμπορική προτεραιότητα.',
  },
  {
    title: 'Έλεγχος ροής αποθέματος',
    description: 'Ευθυγράμμιση stock, εποχικότητας και προωθητικών ενεργειών.',
  },
  {
    title: 'Content Strategy',
    description: 'Προτάσεις περιεχομένου βασισμένες σε πραγματικά audience insights και εμπορικά δεδομένα.',
  },
];

const practiceOutcomes = [
  'Λιγότερη σπατάλη budget σε προϊόντα με χαμηλή διαθεσιμότητα',
  'Μεγαλύτερη αξιοποίηση excess και dead stock',
  'Καλύτερη προτεραιοποίηση προϊόντων βάσει περιθωρίου κέρδους',
  'Καμπάνιες που συμβαδίζουν με τις πραγματικές ανάγκες της αποθήκης',
  'Καθαρότερη εικόνα για το τι αποδίδει εμπορικά και τι όχι',
];

const commerceScenarios = [
  { title: 'Profit Maximization', description: 'Έμφαση σε προϊόντα με υψηλό περιθώριο κέρδους.' },
  { title: 'Stock Clearance', description: 'Διαχείριση dead stock και excess inventory.' },
  { title: 'Brand Launch', description: 'Υποστήριξη νέων προϊόντων και νέων εμπορικών εισόδων.' },
  { title: 'Revenue Push', description: 'Ενίσχυση πωλήσεων σε προϊόντα με υψηλή ζήτηση.' },
  { title: 'Mixed Strategy', description: 'Συνδυασμός πολλαπλών στρατηγικών με προσαρμοσμένα βάρη.' },
  { title: 'Seasonal / Promotional', description: 'Υποστήριξη εκπτώσεων και εποχιακών ενεργειών με έλεγχο αποθέματος.' },
  { title: 'Custom Strategy', description: 'Πλήρως προσαρμοσμένη στρατηγική στις ανάγκες του brand.' },
];

const problemsHowWeHelp = [
  {
    problem: 'Το marketing λειτουργεί χωρίς σύνδεση με το stock',
    helps: 'Η πλατφόρμα προτεραιοποιεί προϊόντα βάσει διαθεσιμότητας, εμπορικής δυναμικής και περιθωρίου κέρδους',
  },
  {
    problem: 'Excess stock και dead inventory μένουν αναξιοποίητα',
    helps: 'Δημιουργεί στρατηγικές προβολής ανά SKU για καλύτερη κυκλοφορία αποθέματος',
  },
  {
    problem: 'Budget allocation χωρίς εμπορικά κριτήρια',
    helps: 'Προτείνει κατανομή budget με βάση πραγματικά δεδομένα πωλήσεων και profitability',
  },
  {
    problem: 'Αποσπασματικά reports χωρίς στρατηγική κατεύθυνση',
    helps: 'Ενοποιεί δεδομένα και τα μετατρέπει σε εφαρμόσιμες εμπορικές αποφάσεις',
  },
  {
    problem: 'Έλλειψη κοινής εικόνας μεταξύ διοίκησης, marketing και συνεργατών',
    helps: 'Δημιουργεί ένα κοινό πλαίσιο αποφάσεων με ξεκάθαρες εμπορικές προτεραιότητες',
  },
];

const appPreviewPoints = [
  {
    title: 'Dashboard',
    featureLabel: 'Dashboard',
    problem:
      'Η διοίκηση δεν διαθέτει ενιαία και αξιόπιστη εικόνα για την εμπορική πορεία της επιχείρησης, συμπεριλαμβανομένων τζίρου, καναλιών και καταστάσεων αποθέματος όπου συνδέονται τα συστήματα.',
    howItWorks:
      'Ενοποιεί KPIs, στρατηγικές προτεραιότητες και κρίσιμα εμπορικά σήματα σε έναν κοινό πίνακα εποπτείας.',
    businessValue:
      'Υποστηρίζει ταχύτερη και πιο τεκμηριωμένη λήψη αποφάσεων, με κοινό σημείο αναφοράς για τη διοίκηση και τα τμήματα.',
    imageSrc: '/landing-screens/dashboard.png',
  },
  {
    title: 'Commercial Strategy',
    featureLabel: 'Commercial Strategy',
    problem:
      'Η ιεράρχηση προϊόντων και καναλιών γίνεται συχνά αποσπασματικά, χωρίς σταθερό διοικητικό πλαίσιο αξιολόγησης.',
    howItWorks:
      'Περιλαμβάνει 7 στρατηγικά σενάρια, όπως κερδοφορία, εκκαθάριση αποθέματος, λανσάρισμα, αύξηση τζίρου, εποχιακές ενέργειες και custom στρατηγικές. Το AI αναλύει κάθε segment πελατών και προσαρμόζει τις προτάσεις για κανάλια και περιεχόμενο με βάση το brand, τα προϊόντα και τους εμπορικούς στόχους.',
    businessValue:
      'Ο προϋπολογισμός κατευθύνεται σε ενέργειες με μεγαλύτερη δυνητική συμβολή στην ανάπτυξη, την απόδοση και το περιθώριο κέρδους.',
    imageSrc: '/landing-screens/commercial-strategy-cards.png',
  },
  {
    title: 'Data Analysis',
    featureLabel: 'Data Analysis',
    problem:
      'Το marketing στοχεύει συχνά οριζόντια, χωρίς επαρκή διαχωρισμό πελατών, προτεραιοτήτων και δυνητικής αξίας.',
    howItWorks:
      'Συνδυάζει RFM, behavioral και predictive analysis για ακριβέστερο segmentation και ιεράρχηση κοινού.',
    businessValue:
      'Οι καμπάνιες αποκτούν υψηλότερη ακρίβεια στόχευσης, αυξημένη πιθανότητα μετατροπής και ισχυρότερη εμπορική αποδοτικότητα.',
    imageSrc: '/landing-screens/data-analysis.png',
  },
  {
    title: 'Product Intelligence',
    featureLabel: 'Product Intelligence',
    problem:
      'Το προϊοντικό χαρτοφυλάκιο αξιολογείται αποσπασματικά, χωρίς σαφή εικόνα για ευκαιρίες, αδυναμίες και προτεραιότητες, αλλά και χωρίς σύνδεση με τη διαθεσιμότητα και τον ρυθμό κίνησης αποθέματος.',
    howItWorks:
      'Εντάσσει τα προϊόντα σε ενιαίο πλαίσιο αξιολόγησης με εμπορικά σήματα, απόδοση και επόμενες προτεραιότητες ανάπτυξης.',
    businessValue:
      'Γίνεται σαφές ποια προϊόντα πρέπει να ενισχυθούν, ποια να προστατευθούν και ποια να επανατοποθετηθούν με επιχειρηματική λογική και σεβασμό στα διαθέσιμα αποθέματα.',
    imageSrc: '/landing-screens/product-intelligence.png',
  },
  {
    title: 'Content Strategy',
    featureLabel: 'Content Strategy',
    problem:
      'Ο σχεδιασμός περιεχομένου εκτελείται χωρίς σαφή σύνδεση με κοινά, στόχους και εμπορικές επιδιώξεις.',
    howItWorks:
      'Μετατρέπει audience insights, επιχειρηματικές προτεραιότητες και AI-powered σήματα σε ξεκάθαρες θεματικές κατευθύνσεις.',
    businessValue:
      'Το περιεχόμενο παύει να είναι αποσπασματικό και ευθυγραμμίζεται άμεσα με το engagement, τη ζήτηση και τις μετατροπές.',
    imageSrc: '/landing-screens/content-strategy.png',
  },
];

const variantCopy: Record<LandingVariant, { finalTitle: string; finalDescription: string }> = {
  ceo: {
    finalTitle: 'Έτοιμο για οργανισμούς που απαιτούν καθαρή λογική αποφάσεων',
    finalDescription:
      'Όταν η επιχείρηση χρειάζεται AI-powered εμπορική νοημοσύνη, συστηματική διακυβέρνηση του marketing και σαφή σύνδεση της απόδοσης με τα έσοδα, το Performance+ λειτουργεί ως ενιαίο λειτουργικό σύστημα εμπορικής ανάπτυξης.',
  },
  ops: {
    finalTitle: 'Το λειτουργικό υπόβαθρο του marketing και του εμπορικού σχεδιασμού',
    finalDescription:
      'Για τμήματα που διαχειρίζονται πολλαπλά κανάλια και αυξημένη επιχειρησιακή πολυπλοκότητα, το Performance+ προσφέρει κοινή ορατότητα, AI-powered καθοδήγηση και συνεχή βελτιστοποίηση της απόδοσης.',
  },
};

// ─── Layout: σχεδόν full width / ~4–5 του viewport (κεντραρισμένο) ─────────────

const LANDING_MAX =
  'mx-auto w-full max-w-[min(90rem,94vw)] px-4 sm:px-6 lg:px-10 xl:px-14';

// ─── Sub-components ─────────────────────────────────────────────────────────────

function isPreviewDarkHighlight(index: number) {
  return index === 1 || index === 3;
}

function PreviewBlock(props: {
  point: (typeof appPreviewPoints)[number];
  index: number;
}) {
  const { point, index } = props;
  const dark = isPreviewDarkHighlight(index);
  const muted = dark ? 'text-white/68' : 'text-[var(--nts-medium-gray)]';
  const heading = dark ? 'text-white' : 'text-[var(--nts-charcoal)]';
  const valueBox = dark
    ? 'mt-4 rounded-xl border border-white/10 bg-white/6 p-4 text-sm font-medium text-white'
    : 'mt-4 rounded-xl border border-[#1f2328]/10 bg-[var(--nts-bg-subtle)] p-4 text-sm font-medium text-[var(--nts-charcoal)]';

  const body = (
    <>
      <div>
        {point.featureLabel !== point.title && (
          <div className="inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.08em] border-current/10 bg-current/5 text-inherit">
            {point.featureLabel}
          </div>
        )}
        <h4 className={dark ? 'mt-3 text-xl font-semibold text-white' : 'mt-3 text-xl font-semibold text-[var(--nts-charcoal)]'}>{point.title}</h4>
        <p className={`mt-3 text-sm leading-7 ${muted}`}>
          <span className={`font-semibold ${heading}`}>Πρόβλημα</span>
          <br />
          {point.problem}
        </p>
        <p className={`mt-2 text-sm leading-7 ${muted}`}>
          <span className={`font-semibold ${heading}`}>Πώς λειτουργεί</span>
          <br />
          {point.howItWorks}
        </p>
      </div>
      <div className={valueBox}>
        <span className={dark ? 'font-semibold text-white/95' : 'font-semibold text-[var(--nts-charcoal)]'}>Επιχειρηματική αξία</span>
        <span className={dark ? 'mt-2 block font-normal text-white/88' : 'mt-2 block font-normal'}>{point.businessValue}</span>
      </div>
    </>
  );

  const hasImage = ['Commercial Strategy', 'Data Analysis', 'Product Intelligence', 'Content Strategy'].includes(point.title) && point.imageSrc;

  return (
    <article
      key={point.title}
      className={[
        'relative overflow-hidden rounded-[24px] border p-5 shadow-[0_10px_24px_rgba(16,24,40,0.1)]',
        dark ? 'border-white/10 bg-[#101319] text-white' : 'border-[#1f2328]/15 bg-[var(--nts-bg-pure)] text-[var(--nts-charcoal)]'
      ].join(' ')}
    >
      <div className="pointer-events-none absolute left-0 top-0 h-1 w-full bg-[var(--nts-accent)]" />
      {hasImage ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.15fr)] lg:items-center xl:gap-10">
          <div className="space-y-4">{body}</div>
          <div className="relative flex min-h-[200px] items-center justify-center overflow-hidden rounded-[20px] border border-[#1f2328]/15 bg-[var(--nts-light-gray)]">
            <img
              src={point.imageSrc}
              alt={`${point.title} screenshot`}
              className="h-auto max-h-[min(480px,50vh)] w-full object-contain"
            />
          </div>
        </div>
      ) : (
        body
      )}
    </article>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export function MarketingIndexPage({
  variant = 'ceo',
  onVariantChange: _onVariantChange,
  onOpenAuth,
  onReturnToApp,
}: MarketingIndexPageProps) {
  const copy = variantCopy[variant];
  void _onVariantChange;

  const scrollRef = useRef<HTMLDivElement>(null);

  const mailDemoHref = `mailto:${MARKETING_CONTACT_MAILTO}?subject=${encodeURIComponent('Performance+ Demo Request')}`;

  return (
    <div ref={scrollRef} className="h-screen overflow-y-auto overflow-x-hidden bg-[var(--nts-bg-subtle)] text-[var(--nts-charcoal)]">

      {/* ── Sticky header ────────────────────────────────────────────────── */}
      <header className="relative z-20">
        <div className={`${LANDING_MAX} pt-5`}>
          <div className="rounded-[22px] border border-[#1f2328]/10 bg-[var(--nts-bg-pure)] px-4 py-3 shadow-[0_10px_24px_rgba(16,24,40,0.08)] md:px-5">
            <div className={`flex items-center gap-3 sm:gap-4 ${onReturnToApp || onOpenAuth ? 'justify-between' : ''}`}>
              <div className="flex min-w-0 flex-row items-center gap-3 sm:gap-4">
                <PerformancePlusLogo height={52} className="shrink-0 max-w-[min(100%,85vw)] sm:h-auto" />
                <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-[var(--nts-charcoal)] sm:text-base">{MARKETING_TAGLINE_HEADER}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {onOpenAuth && (
                  <button
                    type="button"
                    onClick={onOpenAuth}
                    className="rounded-xl border border-[var(--nts-accent-hover)] bg-[var(--nts-accent)] px-3 py-2 text-sm font-semibold text-white shadow-[0_6px_14px_rgba(249,115,22,0.35)] transition hover:bg-[var(--nts-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nts-accent)] sm:px-4"
                  >
                    Σύνδεση
                  </button>
                )}
                {onReturnToApp && (
                  <button
                    type="button"
                    onClick={onReturnToApp}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-[#6B7280] transition hover:bg-[var(--nts-light-gray)] hover:text-[var(--nts-charcoal)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nts-accent)]"
                  >
                    <ArrowLeft size={14} strokeWidth={2} aria-hidden />
                    Επιστροφή στην εφαρμογή
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className={`${LANDING_MAX} pb-6 pt-4 md:pt-5`}>
        <div className="relative overflow-hidden rounded-[36px] border border-[#1f2328]/10 bg-[var(--nts-bg-pure)] px-5 py-6 shadow-[0_24px_56px_rgba(16,24,40,0.12)] sm:px-7 md:px-10 md:py-8 lg:px-12">
          <div className="pointer-events-none absolute right-[-80px] top-[-20px] h-64 w-64 rounded-full bg-[var(--nts-accent)]/12 blur-3xl" />
          <div className="pointer-events-none absolute bottom-[-100px] left-[-20px] h-72 w-72 rounded-full bg-[#1f2328]/4 blur-3xl" />

          <div className="relative">
            <div className="grid gap-6 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-8 xl:gap-12">
              <div className="space-y-4">
                <h1 className="max-w-none leading-[1.08] text-[var(--nts-charcoal)]">
                  <span className="block text-3xl font-bold md:text-5xl lg:text-6xl">Performance+:</span>
                  <span className="mt-2 block text-2xl font-semibold text-[var(--nts-accent)] md:text-3xl lg:text-[2.75rem]">{MARKETING_TAGLINE_HEADER}</span>
                </h1>
                <div className="max-w-none space-y-3 text-[15px] leading-7 text-[var(--nts-medium-gray)] md:text-base lg:pr-2">
                  {heroParagraphs.map((p) => (
                    <p key={p}>{p}</p>
                  ))}
                </div>

                <div className="flex flex-wrap gap-3">
                  <a
                    href={mailDemoHref}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#1f2328]/10 bg-[var(--nts-bg-subtle)] px-5 py-3 text-sm font-semibold text-[var(--nts-charcoal)] transition hover:bg-[var(--nts-light-gray)]"
                  >
                    <HelpCircle size={16} />
                    Ζητήστε demo
                  </a>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-[22px] border border-[#1f2328]/15 bg-[var(--nts-light-gray)] shadow-[0_10px_24px_rgba(16,24,40,0.1)]">
                <img
                  src="/landing-screens/commercial-strategy-hero.png"
                  alt="Performance+ Commercial Strategy dashboard"
                  className="h-auto w-full object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Από τα δεδομένα στη στρατηγική εικόνα ─────────────────────────── */}
      <section className={`${LANDING_MAX} pb-8`}>
        <div className="rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)] md:p-8">
          <p className="text-[11px] tracking-[0.08em] text-[var(--nts-accent)]">Δεδομένα → Εποπτεία</p>
          <h3 className="mt-2 text-lg font-semibold text-[var(--nts-charcoal)] md:text-xl">Από τα δεδομένα στη στρατηγική εικόνα</h3>
          <p className="mt-3 max-w-none text-sm leading-7 text-[var(--nts-medium-gray)] md:text-base">
            Το Performance+ συγκεντρώνει πληροφορίες από όλα τα κρίσιμα σημεία του e-commerce σε ένα ενιαίο περιβάλλον εμπορικής εποπτείας.
          </p>

          <p className="mt-6 text-[11px] font-semibold tracking-[0.08em] text-[var(--nts-medium-gray)]">Εισαγωγή δεδομένων</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {dataIntroSources.map((source) => (
              <div key={source.name} className="rounded-xl border border-[#1f2328]/12 bg-[var(--nts-bg-subtle)] p-4 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-[#1f2328]/10 bg-[var(--nts-bg-pure)] text-[var(--nts-charcoal)]">
                  {source.icon}
                </div>
                <p className="mt-3 text-sm font-semibold text-[var(--nts-charcoal)]">{source.name}</p>
                <p className="mt-1 text-xs text-[var(--nts-medium-gray)]">{source.description}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-xl border border-[var(--nts-accent)]/25 bg-[var(--nts-accent)]/6 px-4 py-3 md:items-center md:gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#1f2328]/10 bg-[var(--nts-bg-pure)] text-[var(--nts-charcoal)]">
              <Upload size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--nts-charcoal)]">Γρήγορη διασύνδεση πλατφορμών</p>
              <p className="mt-1 text-xs text-[var(--nts-medium-gray)] md:text-sm">Άμεση ενεργοποίηση χωρίς πολύπλοκες διαδικασίες εγκατάστασης.</p>
            </div>
          </div>

          <div className="mt-10 border-t border-[#1f2328]/10 pt-8">
            <p className="text-[11px] font-semibold tracking-[0.08em] text-[var(--nts-accent)]">Εμπορική νοημοσύνη μέσω AI</p>
            <p className="mt-3 text-sm leading-7 text-[var(--nts-medium-gray)] md:text-base">
              Η πλατφόρμα αναλύει τα δεδομένα και δημιουργεί στρατηγική καθοδήγηση σε πέντε βασικούς άξονες:
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {aiIntelligenceAxes.map((axis) => (
                <div key={axis.title} className="rounded-xl border border-[#1f2328]/12 bg-[#12151b] px-4 py-4 text-left shadow-[0_6px_16px_rgba(15,17,21,0.12)]">
                  <p className="text-sm font-semibold text-white">{axis.title}</p>
                  <p className="mt-2 text-xs leading-relaxed text-white/70 md:text-sm">{axis.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Γιατί ξεχωρίζει ──────────────────────────────────────────────── */}
      <section className={`${LANDING_MAX} pb-8`}>
        <div className="grid items-stretch gap-5 lg:grid-cols-[1fr_1fr] lg:gap-8">
          <div className="rounded-[28px] border border-[#1f2328]/10 bg-[var(--nts-bg-pure)] p-6 shadow-[0_18px_40px_rgba(16,24,40,0.12)] md:p-8">
            <p className="text-[11px] tracking-[0.08em] text-[var(--nts-accent)]">Διαφορά</p>
            <h2 className="mt-4 text-xl font-semibold leading-snug text-[var(--nts-charcoal)] md:text-2xl">Γιατί ξεχωρίζει το Performance+</h2>
            <div className="mt-5 space-y-4 text-sm leading-7 text-[var(--nts-medium-gray)] md:text-[15px]">
              <p>Οι περισσότερες πλατφόρμες marketing βλέπουν μόνο διαφημίσεις και conversions.</p>
              <p>Το Performance+ βλέπει τη συνολική εμπορική εικόνα της επιχείρησης.</p>
              <p>
                Συνδέει marketing, stock, προϊόντα και κερδοφορία σε ένα ενιαίο περιβάλλον αποφάσεων, ώστε το budget να κατευθύνεται εκεί όπου υπάρχει πραγματική εμπορική αξία.
              </p>
            </div>
          </div>

          <div className="rounded-[26px] border border-[#1f2328]/10 bg-[#12151b] p-6 shadow-[0_18px_40px_rgba(15,17,21,0.18)] md:p-8">
            <p className="text-[11px] tracking-[0.08em] text-[var(--nts-accent)]">Στην πράξη</p>
            <h2 className="mt-4 text-xl font-semibold text-white md:text-2xl">Τι σημαίνει αυτό στην πράξη</h2>
            <ul className="mt-6 space-y-3">
              {practiceOutcomes.map((line) => (
                <li key={line} className="flex items-start gap-3 text-sm leading-6 text-white/76 md:text-[15px]">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--nts-accent)]" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── 7 σενάρια ───────────────────────────────────────────────────── */}
      <section className={`${LANDING_MAX} pb-8`}>
        <div className="rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)] md:p-8">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)] md:text-xl">Τα 7 εμπορικά σενάρια</h3>
          <p className="mt-3 max-w-none text-sm leading-7 text-[var(--nts-medium-gray)] md:text-base">
            Το Performance+ επιτρέπει στην επιχείρηση να συγκρίνει διαφορετικές στρατηγικές πριν δεσμεύσει budget. Οι προτάσεις προσαρμόζονται στο brand, στη ζήτηση και στα επίπεδα αποθέματος ανά SKU.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {commerceScenarios.map((s) => (
              <div key={s.title} className="rounded-xl border border-[#1f2328]/12 bg-[var(--nts-bg-subtle)] p-4">
                <p className="text-sm font-semibold text-[var(--nts-charcoal)]">{s.title}</p>
                <p className="mt-2 text-xs leading-relaxed text-[var(--nts-medium-gray)] md:text-sm">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Ποια προβλήματα επιλύει ─────────────────────────────────────── */}
      <section className={`${LANDING_MAX} pb-8`}>
        <div className="rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)] md:p-8">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)] md:text-xl">Ποια προβλήματα επιλύει</h3>

          <div className="mt-2 hidden rounded-t-xl bg-[#1f2328] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-white/85 md:grid md:grid-cols-2 md:gap-4">
            <span>Πρόβλημα</span>
            <span>Πώς βοηθά το Performance+</span>
          </div>

          <div className="mt-0 divide-y divide-[#1f2328]/12 overflow-hidden rounded-b-xl rounded-t-xl border border-[#1f2328]/12 md:mt-0 md:rounded-t-none md:border-t-0">
            {problemsHowWeHelp.map((row, i) => (
              <div key={i} className="grid grid-cols-1 gap-0 md:grid-cols-2">
                <div className="border-b border-[#1f2328]/8 bg-[#fafafa] px-5 py-4 md:border-b-0 md:border-r md:border-[#1f2328]/8">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--nts-medium-gray)] md:hidden">Πρόβλημα</p>
                  <p className="mt-1 text-sm font-medium leading-relaxed text-[var(--nts-charcoal)] md:mt-0">{row.problem}</p>
                </div>
                <div className="bg-[var(--nts-bg-pure)] px-5 py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--nts-accent)] md:hidden">Πώς βοηθά το Performance+</p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--nts-charcoal)] md:mt-0">{row.helps}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5 περιβάλλοντα ──────────────────────────────────────────────── */}
      <section className={`${LANDING_MAX} pb-8`}>
        <div className="rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)] md:p-8">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)] md:text-xl">Τα 5 βασικά περιβάλλοντα του Performance+</h3>
          <p className="mt-2 text-sm text-[var(--nts-medium-gray)]">
            Πώς το Performance+ μετατρέπει δεδομένα και νοημοσύνη σε στοχευμένη εμπορική δράση.
          </p>

          <div className="mt-6 grid gap-5">
            {appPreviewPoints.map((point, index) => (
              <PreviewBlock key={point.title} point={point} index={index} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Εκδήλωση ενδιαφέροντος ───────────────────────────────────────── */}
      <section id="interest" className={`${LANDING_MAX} pb-8`}>
        <InterestForm />
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────────── */}
      <section className={`${LANDING_MAX} pb-8`}>
        <div className="rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)] md:p-8">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">{copy.finalTitle}</h3>
          <p className="mt-2 max-w-none text-sm text-[var(--nts-medium-gray)] md:text-base">{copy.finalDescription}</p>

          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={mailDemoHref}
              className="inline-flex items-center gap-2 rounded-xl border border-[#1f2328] bg-[var(--nts-bg-pure)] px-5 py-3 text-sm font-semibold text-[#1f2328] transition hover:bg-[var(--nts-light-gray)]"
            >
              <HelpCircle size={16} />
              Ζητήστε demo
            </a>
          </div>

          <p className="mt-4 text-xs text-[var(--nts-medium-gray)]">
            Εναλλακτικά,{' '}
            <a
              href={`mailto:${MARKETING_CONTACT_MAILTO}?subject=${encodeURIComponent('Performance+ — Επικοινωνία')}`}
              className="font-semibold text-[var(--nts-charcoal)] underline underline-offset-2 hover:text-[var(--nts-accent)]"
            >
              επικοινώνησε μέσω email
            </a>
            {' '}
            για εταιρική ένταξη, εμπορική πολιτική ή εξειδικευμένη προσαρμογή του AI-powered περιβάλλοντος αποφάσεων.
          </p>
        </div>
      </section>

      {/* ── Compliance trust bar ─────────────────────────────────────────── */}
      <section className={`${LANDING_MAX} pb-8`}>
        <div className="flex flex-wrap items-center justify-center gap-6 rounded-2xl border border-[#1f2328]/10 bg-[var(--nts-bg-subtle)] px-6 py-4 md:px-10">
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
      <footer className={`${LANDING_MAX} pb-10 pt-2`}>
        <div className="flex flex-col gap-4 border-t border-[#1f2328]/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--nts-medium-gray)]">
            <span className="shrink-0">Υποστήριξη και τεχνολογία:</span>
            <a
              href="https://notthesame.gr"
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 font-semibold text-[var(--nts-charcoal)] underline-offset-2 transition hover:text-[var(--nts-accent)] hover:underline"
            >
              notthesame.ai
              <ExternalLink size={12} className="opacity-70" aria-hidden />
            </a>
          </div>
          <div className="flex flex-col items-start gap-1 text-xs sm:items-end">
            <p className="text-[var(--nts-medium-gray)]">AI-powered πλατφόρμα εμπορικής και επιχειρησιακής νοημοσύνης</p>
            <div className="flex items-center gap-3">
              <a
                href="/privacy"
                className="font-medium text-[var(--nts-medium-gray)] hover:text-[var(--nts-accent)] hover:underline"
              >
                Απόρρητο
              </a>
              <span className="text-[var(--nts-medium-gray)]/40">·</span>
              <a
                href="/terms"
                className="font-medium text-[var(--nts-medium-gray)] hover:text-[var(--nts-accent)] hover:underline"
              >
                Όροι
              </a>
              <span className="text-[var(--nts-medium-gray)]/40">·</span>
              <a
                href={`mailto:${MARKETING_CONTACT_MAILTO}?subject=${encodeURIComponent('Performance+ Επικοινωνία')}`}
                className="inline-flex items-center gap-1.5 font-medium text-[var(--nts-charcoal)] hover:text-[var(--nts-accent)] hover:underline"
              >
                <Mail size={13} aria-hidden />
                Επικοινωνία
              </a>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}
