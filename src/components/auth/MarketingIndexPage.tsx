import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BarChart3, Brain, Database, Euro, FileText, FileSpreadsheet, HelpCircle, LayoutDashboard, Megaphone, Package, ShieldCheck, SlidersHorizontal, Target, Upload, Users } from 'lucide-react';

type LandingVariant = 'ceo' | 'ops';

interface MarketingIndexPageProps {
  onOpenAuth: () => void;
  variant?: LandingVariant;
  onVariantChange?: (variant: LandingVariant) => void;
}

// ─── Static data ─────────────────────────────────────────────────────────────

const metrics = [
  { label: 'πηγές δεδομένων (ERP, Ads, CSV, χειροκίνητα)', value: '5', suffix: '+' },
  { label: 'modules ενεργά — από data analysis έως content strategy', value: '7', suffix: '' },
  { label: 'ολοκληρωμένος κύκλος: data → intelligence → activation', value: '1', suffix: '' },
];

const dataSources = [
  { name: 'ERP / Πωλήσεις', description: 'Προϊόντα, απόθεμα, τιμολόγηση, πελατολόγιο', icon: <Database size={18} /> },
  { name: 'Google Ads', description: 'Campaigns, κόστος, conversions, κοινά', icon: <BarChart3 size={18} /> },
  { name: 'Meta Ads', description: 'Campaigns, audiences, Meta-IDs, attribution', icon: <Target size={18} /> },
  { name: 'CSV / Excel', description: 'Segments, οικονομικά, analytics, custom data', icon: <FileSpreadsheet size={18} /> },
  { name: 'Χειροκίνητη εισαγωγή', description: 'KPIs, budgets, στρατηγικές παράμετροι', icon: <Upload size={18} /> },
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

const coreFeatures = [
  { title: 'Strategy Weights', description: 'Μεταφράζει τη στρατηγική της επιχείρησης σε μετρήσιμες βαρύτητες, ώστε κάθε απόφαση να αξιολογείται με ενιαία διοικητική λογική.', icon: <SlidersHorizontal size={18} /> },
  { title: 'Data Analysis', description: 'Μετατρέπει τα δεδομένα πελατών σε εφαρμόσιμη εμπορική νοημοσύνη μέσω RFM, behavioral, firmographic και αξιακής ανάλυσης.', icon: <Users size={18} /> },
  { title: 'Product Intelligence', description: 'Αναδεικνύει την πραγματική εμπορική δυναμική του χαρτοφυλακίου με πολυπαραγονική αξιολόγηση, ιεράρχηση και σαφή σήματα απόφασης.', icon: <Package size={18} /> },
  { title: 'Channel Activation', description: 'Μετατρέπει insights και προτεραιότητες σε AI-powered κατευθύνσεις για κανάλια, ενέργειες και κατανομή επένδυσης.', icon: <Megaphone size={18} /> },
];

const problemsBeforeAfter = [
  {
    before: 'Αποσπασματικά reports, ασύνδετα εργαλεία και αργή μετάβαση από την πληροφορία στην απόφαση.',
    after: 'Ένα ενιαίο AI-powered σύστημα που μετατρέπει τα δεδομένα σε καθαρή στρατηγική εικόνα και εφαρμόσιμη καθοδήγηση.',
  },
  {
    before: 'Κατανομή προϋπολογισμού χωρίς τεκμηριωμένη αποτίμηση της απόδοσης ανά κανάλι ή πρωτοβουλία.',
    after: 'Σαφές πλαίσιο ROI attribution και εμπορικού πλαισίου αναφορών, ώστε να γνωρίζεις τι αποδίδει, τι αναστέλλεται και τι κλιμακώνεται.',
  },
  {
    before: 'Εκτέλεση ενεργειών marketing χωρίς κοινό στρατηγικό πλαίσιο μεταξύ διοίκησης, ομάδων και συνεργατών.',
    after: 'Κοινό σύστημα αποφάσεων που ευθυγραμμίζει διοίκηση, εσωτερικά τμήματα και εξωτερικούς συνεργάτες.',
  },
];

const operatingFlow = [
  { step: '01', title: 'Ενοποίηση δεδομένων', description: 'Εισάγεις δεδομένα από ERP, διαφημιστικές κονσόλες (Google Ads, Meta), οικονομικά στοιχεία και πελατολόγιο — μέσω CSV ή χειροκίνητα. Με ή χωρίς API — zero setup time.', icon: <LayoutDashboard size={18} /> },
  { step: '02', title: 'Εμπορική νοημοσύνη με AI', description: 'Η ανάλυση δεδομένων, το segmentation και η αξιολόγηση προϊόντων αποκαλύπτουν πού βρίσκεται η πραγματική εμπορική δυναμική.', icon: <Users size={18} /> },
  { step: '03', title: 'Στρατηγική καθοδήγηση', description: 'Το σύστημα προτείνει προτεραιότητες για κανάλια, περιεχόμενο και εμπορικές κινήσεις με εφαρμόσιμη λογική απόφασης.', icon: <Target size={18} /> },
  { step: '04', title: 'Διακυβέρνηση απόδοσης', description: 'Παρακολουθείς την επίδραση, επανακατανέμεις επένδυση και βελτιστοποιείς με συνεχή κύκλο λήψης αποφάσεων.', icon: <Euro size={18} /> },
];

const valuePillars = [
  { title: 'Για τη Διοίκηση', description: 'Παρέχει ενιαία εικόνα για εμπορική επίδοση, περιθώρια κέρδους, ρίσκο και στρατηγικές προτεραιότητες.', icon: <BarChart3 size={18} /> },
  { title: 'Για το Marketing', description: 'Μετατρέπει τα δεδομένα και τα AI-powered insights σε εφαρμόσιμη καθοδήγηση ανά κοινό, καμπάνια και δημιουργική προτεραιότητα.', icon: <Megaphone size={18} /> },
  { title: 'Για τον Οργανισμό', description: 'Εδραιώνει κοινή γλώσσα αποφάσεων μεταξύ διοίκησης, εμπορικής διεύθυνσης, finance, operations και marketing.', icon: <FileText size={18} /> },
  { title: 'Για Finance & Operations', description: 'Ενισχύει τον έλεγχο του προϋπολογισμού, της αποδοτικότητας και του πραγματικού επιχειρησιακού αντίκτυπου με μετρήσιμη λογική.', icon: <Euro size={18} /> },
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
    title: 'Strategy Weights',
    featureLabel: 'Strategy Weights',
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
    highlight: 'το λειτουργικό σύστημα της επιχειρηματικής ανάπτυξης',
    description: 'Αναλύει δεδομένα κοινού και αποθέματος, μετατρέπει την πληροφορία σε επιχειρηματική νοημοσύνη και προτείνει σενάρια εμπορικής πολιτικής, κατάλληλα προωθητικά κανάλια και οργανικό περιεχόμενο. Παράλληλα, συντονίζει τα εσωτερικά τμήματα και τους εξωτερικούς συνεργάτες, μειώνοντας τον κατακερματισμό της πληροφορίας και τις καθυστερήσεις που επιβραδύνουν την ανάπτυξη.',
    cta: 'Είσοδος στο Performance+',
    uspTitle: 'Γιατί ξεχωρίζει',
    uspPoints: [
      'Μετατρέπει τα εμπορικά δεδομένα σε διοικητική καθοδήγηση προσανατολισμένη στην κερδοφορία και στην εφαρμογή.',
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
    highlight: 'το λειτουργικό σύστημα της επιχειρηματικής ανάπτυξης',
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

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 1400, active: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) return;
    let start = 0;
    const step = Math.ceil(target / (duration / 16));
    const timer = setInterval(() => {
      start = Math.min(start + step, target);
      setCount(start);
      if (start >= target) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration, active]);
  return count;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricItem({ value, suffix, label, active }: { value: number; suffix: string; label: string; active: boolean }) {
  const count = useCountUp(value, 1200, active);
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-4 text-center">
      <p className="text-3xl font-bold text-[#1f2328] md:text-4xl">
        {count}{suffix}
      </p>
      <p className="text-xs text-[var(--nts-medium-gray)]">{label}</p>
    </div>
  );
}

function isDarkHighlight(index: number) {
  const row = Math.floor(index / 2);
  const isRightColumn = index % 2 === 1;
  return row % 2 === 0 ? isRightColumn : !isRightColumn;
}

function isPreviewDarkHighlight(index: number) {
  return index === 1 || index === 3;
}

function EditorialCard({
  title,
  description,
  icon,
  eyebrow,
  stat,
  dark = false
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  eyebrow: string;
  stat: string;
  dark?: boolean;
}) {
  return (
    <article
      className={[
        'group relative min-h-[280px] overflow-hidden rounded-[28px] border p-6 transition duration-300',
        dark
          ? 'border-white/10 bg-[#0f1115] text-white shadow-[0_22px_50px_rgba(15,17,21,0.34)]'
          : 'border-[#1f2328]/15 bg-[var(--nts-bg-pure)] text-[var(--nts-charcoal)] shadow-[0_18px_36px_rgba(16,24,40,0.12)] hover:border-[var(--nts-accent)]/35',
      ].join(' ')}
    >
      <div
        className={[
          'pointer-events-none absolute right-[-28px] top-[-24px] h-36 w-36 rounded-full blur-2xl',
          dark ? 'bg-[var(--nts-accent)]/25' : 'bg-[#1f2328]/6'
        ].join(' ')}
      />
      <div
        className={[
          'pointer-events-none absolute bottom-4 right-4 h-20 w-20 rounded-3xl border',
          dark ? 'border-white/10 bg-white/5' : 'border-[#1f2328]/10 bg-[var(--nts-bg-subtle)]'
        ].join(' ')}
      />
      <div className="relative flex h-full flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-4">
            <div
              className={[
                'inline-flex h-11 w-11 items-center justify-center rounded-2xl border',
                dark
                  ? 'border-white/12 bg-white/6 text-white'
                  : 'border-[#1f2328]/10 bg-[var(--nts-bg-subtle)] text-[var(--nts-charcoal)]'
              ].join(' ')}
            >
              {icon}
            </div>
            <span
              className={[
                'rounded-full px-3 py-1 text-[11px] font-semibold tracking-[0.08em]',
                dark
                  ? 'border border-white/10 bg-white/6 text-white/72'
                  : 'border border-[#1f2328]/10 bg-[var(--nts-bg-subtle)] text-[var(--nts-medium-gray)]'
              ].join(' ')}
            >
              {eyebrow}
            </span>
          </div>

          <div className="mt-8 space-y-3">
            <h3 className={dark ? 'max-w-xs text-[28px] font-semibold leading-[1.05] text-white' : 'max-w-xs text-[28px] font-semibold leading-[1.05] text-[var(--nts-charcoal)]'}>
              {title}
            </h3>
            <p className={dark ? 'max-w-sm text-sm leading-6 text-white/72' : 'max-w-sm text-sm leading-6 text-[var(--nts-medium-gray)]'}>
              {description}
            </p>
          </div>
        </div>

        <div className="relative mt-8 flex items-end justify-between gap-4">
          <div className={dark ? 'space-y-1' : 'space-y-1'}>
            <p className={dark ? 'text-[11px] tracking-[0.08em] text-white/52' : 'text-[11px] tracking-[0.08em] text-[var(--nts-medium-gray)]'}>
              Εστίαση
            </p>
            <p className={dark ? 'text-2xl font-semibold text-white' : 'text-2xl font-semibold text-[var(--nts-charcoal)]'}>
              {stat}
            </p>
          </div>
          <div className="flex items-end gap-1.5">
            <span className={dark ? 'h-8 w-2 rounded-full bg-white/20' : 'h-8 w-2 rounded-full bg-[#1f2328]/10'} />
            <span className="h-12 w-2 rounded-full bg-[var(--nts-accent)]" />
            <span className={dark ? 'h-16 w-2 rounded-full bg-white/50' : 'h-16 w-2 rounded-full bg-[#1f2328]'} />
          </div>
        </div>
      </div>
    </article>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function MarketingIndexPage({ onOpenAuth, variant = 'ceo', onVariantChange: _onVariantChange }: MarketingIndexPageProps) {
  const copy = variantCopy[variant];
  void _onVariantChange;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  void scrolled;
  const [metricsVisible, setMetricsVisible] = useState(false);
  const metricsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 60);
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    const metricsEl = metricsRef.current;
    if (!el || !metricsEl) return;
    const onScroll = () => {
      const rect = metricsEl.getBoundingClientRect();
      if (rect.top < window.innerHeight - 80) setMetricsVisible(true);
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div ref={scrollRef} className="h-screen overflow-y-auto overflow-x-hidden bg-[var(--nts-bg-subtle)] text-[var(--nts-charcoal)]">

      {/* ── Sticky header ────────────────────────────────────────────────── */}
      <header className="relative z-20">
        <div className="mx-auto w-full max-w-7xl px-6 pt-5 md:px-10">
          <div className="rounded-[22px] border border-[#1f2328]/10 bg-[var(--nts-bg-pure)] px-4 py-3 shadow-[0_10px_24px_rgba(16,24,40,0.08)] md:px-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#1f2328]/10 bg-[var(--nts-bg-subtle)] text-[var(--nts-charcoal)]">
                  <Brain size={18} />
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
                <h1 className="max-w-4xl text-3xl font-semibold leading-[1.04] text-[var(--nts-charcoal)] md:text-5xl">
                  {copy.headline}
                  {copy.highlight && (
                    <span className="mt-2 block text-[var(--nts-accent)]">{copy.highlight}</span>
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

      {/* ── Data Sources ──────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)]">
          <p className="text-[11px] tracking-[0.08em] text-[var(--nts-accent)]">Πηγές Δεδομένων</p>
          <h3 className="mt-2 text-lg font-semibold text-[var(--nts-charcoal)]">Με ή χωρίς API — zero setup time</h3>
          <p className="mt-1 text-sm text-[var(--nts-medium-gray)]">Εισάγεις δεδομένα από τις πηγές που ήδη χρησιμοποιείς. CSV, χειροκίνητα ή μέσω API integrations.</p>
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
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="grid items-stretch gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[28px] border border-[#1f2328]/10 bg-[var(--nts-bg-pure)] p-6 shadow-[0_18px_40px_rgba(16,24,40,0.12)]">
            <p className="text-[11px] tracking-[0.08em] text-[var(--nts-accent)]">Διοικητική Επισκόπηση</p>
            <h2 className="mt-4 max-w-2xl text-xl font-semibold leading-tight text-[var(--nts-charcoal)]">
              Το κεντρικό control layer για επιχειρηματίες και στελέχη που θέλουν καθαρή λογική αποφάσεων και συντονισμένη εκτέλεση.
            </h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-[#12151b] p-5 shadow-[0_10px_24px_rgba(15,17,21,0.16)]">
                <p className="text-[11px] tracking-[0.08em] text-[var(--nts-accent)]">Εποπτεία</p>
                <p className="mt-2 text-2xl font-semibold text-white">360°</p>
                <p className="mt-2 text-sm leading-6 text-white/68">Συγκεντρώνεις κρίσιμα δεδομένα, προϊόντα, κοινά και κανάλια σε ένα ενιαίο πεδίο διοικητικής αναφοράς.</p>
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

      {/* ── Core features ────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="grid gap-5 md:grid-cols-2">
          {coreFeatures.map((feature, index) => (
            <EditorialCard
              key={feature.title}
              title={feature.title}
              description={feature.description}
              icon={feature.icon}
              eyebrow={index % 2 === 0 ? 'Στρατηγική ενότητα' : 'Επίπεδο ΤΝ'}
              stat={['Στρατηγική με έμφαση στο Gross Margin', 'Στόχευση Αγοραστικού Κοινού Υψηλής Αξίας', 'Εστίαση σε New Releases', 'Επιλογή Ιδανικών Καναλιών Επικοινωνίας'][index] ?? 'Απόδοση'}
              dark={isDarkHighlight(index)}
            />
          ))}
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

      {/* ── Operating flow ────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)]">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">Πώς λειτουργεί: από τα δεδομένα στη στρατηγική απόφαση</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {operatingFlow.map((item) => (
              <article key={item.step} className="rounded-xl border border-[#1f2328]/20 bg-[var(--nts-bg-pure)] p-4 transition hover:border-[var(--nts-accent)]/35">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#1f2328]/30 text-[#1f2328]">
                    {item.icon}
                  </div>
                  <span className="text-xs font-bold tracking-widest text-[var(--nts-accent)]">{item.step}</span>
                </div>
                <h4 className="mt-3 text-sm font-semibold text-[var(--nts-charcoal)]">{item.title}</h4>
                <p className="mt-2 text-sm text-[var(--nts-medium-gray)]">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Value pillars ─────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)]">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">Τι υπεραξία προσφέρει ως κοινό σύστημα αποφάσεων</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {valuePillars.map((item, index) => (
              <article
                key={item.title}
                className={[
                  'relative overflow-hidden rounded-[24px] border p-5',
                  isDarkHighlight(index)
                    ? 'border-white/10 bg-[#12151b] text-white'
                    : 'border-[#1f2328]/12 bg-[var(--nts-bg-subtle)] text-[var(--nts-charcoal)]'
                ].join(' ')}
              >
                <div
                  className={[
                    'pointer-events-none absolute right-0 top-0 h-24 w-24 rounded-full blur-2xl',
                    isDarkHighlight(index) ? 'bg-[var(--nts-accent)]/20' : 'bg-[#1f2328]/6'
                  ].join(' ')}
                />
                <div
                  className={[
                    'inline-flex h-10 w-10 items-center justify-center rounded-2xl border',
                    isDarkHighlight(index)
                      ? 'border-white/10 bg-white/6 text-white'
                      : 'border-[#1f2328]/10 bg-[var(--nts-bg-pure)] text-[var(--nts-charcoal)]'
                  ].join(' ')}
                >
                  {item.icon}
                </div>
                <h4 className={isDarkHighlight(index) ? 'relative mt-6 text-xl font-semibold text-white' : 'relative mt-6 text-xl font-semibold text-[var(--nts-charcoal)]'}>
                  {item.title}
                </h4>
                <p className={isDarkHighlight(index) ? 'relative mt-3 max-w-md text-sm leading-6 text-white/72' : 'relative mt-3 max-w-md text-sm leading-6 text-[var(--nts-medium-gray)]'}>
                  {item.description}
                </p>
                <div className="relative mt-8 flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--nts-accent)]" />
                  <span className={isDarkHighlight(index) ? 'text-xs tracking-[0.08em] text-white/56' : 'text-xs tracking-[0.08em] text-[var(--nts-medium-gray)]'}>
                    {index % 2 === 0 ? 'Υποστήριξη απόφασης' : 'Υποστήριξη εκτέλεσης'}
                  </span>
                </div>
              </article>
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

      {/* ── Metrics strip ────────────────────────────────────────────────── */}
      <div ref={metricsRef} className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="grid divide-x divide-[#1f2328]/15 rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] shadow-[0_16px_32px_rgba(16,24,40,0.12)] md:grid-cols-3">
          {metrics.map((m) => (
            <MetricItem key={m.label} value={parseInt(m.value)} suffix={m.suffix} label={m.label} active={metricsVisible} />
          ))}
        </div>
      </div>

      {/* ── Input → Output chain ─────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_18px_40px_rgba(16,24,40,0.14)]">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">Data Input → Commercial Intelligence Output</h3>
          <p className="mt-1 text-sm text-[var(--nts-medium-gray)]">Από πρωτογενή δεδομένα σε εφαρμόσιμη εμπορική καθοδήγηση — end-to-end.</p>

          <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto_1fr]">
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
                <div className="h-16 w-px bg-[var(--nts-accent)]/40" />
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--nts-accent)] text-white shadow-[0_6px_14px_rgba(249,115,22,0.35)]">
                  <ArrowRight size={16} />
                </div>
                <p className="text-[10px] font-semibold tracking-[0.08em] text-[var(--nts-accent)]">AI</p>
                <div className="h-16 w-px bg-[var(--nts-accent)]/40" />
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
              Ενεργοποίησε τον χώρο εργασίας σου
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
