import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BarChart3, Brain, Euro, FileText, HelpCircle, LayoutDashboard, Lock, Megaphone, Package, Shield, SlidersHorizontal, Sparkles, Target, Users, Zap } from 'lucide-react';

type LandingVariant = 'ceo' | 'ops';

interface MarketingIndexPageProps {
  onOpenAuth: () => void;
  variant?: LandingVariant;
  onVariantChange?: (variant: LandingVariant) => void;
}

// ─── Static data ─────────────────────────────────────────────────────────────

const metrics = [
  { label: 'Ενιαίο σύστημα αποφάσεων', value: '1', suffix: ' platform' },
  { label: 'Commercial view', value: '360', suffix: '°' },
  { label: 'ROI tracked per action', value: '100', suffix: '%' },
];

const coreFeatures = [
  { title: 'Strategy Weights', description: 'Ρυθμίζει factors προτεραιοποίησης με τρόπο που ταιριάζει στο εμπορικό σου μοντέλο.', icon: <SlidersHorizontal size={18} /> },
  { title: 'RFM Analysis', description: 'Μετατρέπει raw δεδομένα σε εμπορικά χρήσιμα segments με ξεκάθαρες προτεραιότητες.', icon: <Users size={18} /> },
  { title: 'Product Prioritization', description: 'Κατατάσσει portfolio με multi-factor scoring για γρήγορες αποφάσεις growth.', icon: <Package size={18} /> },
  { title: 'Channel Activation', description: 'AI recommendations για τα επόμενα κανάλια και τις πιο αποδοτικές ενέργειες.', icon: <Megaphone size={18} /> },
];

const problemsBeforeAfter = [
  {
    before: 'Διασκορπισμένα reports, ασύνδετα εργαλεία και καθυστερημένο optimization.',
    after: 'Ένα σύστημα, μία εικόνα: real-time intelligence για κάθε εμπορική απόφαση.',
  },
  {
    before: 'Budget allocation χωρίς πραγματική απόδειξη απόδοσης ανά κανάλι.',
    after: 'Σαφής ROI attribution: ξέρεις τι αποδίδει, τι σταματάς και τι κλιμακώνεις.',
  },
  {
    before: 'Marketing execution χωρίς κοινή στρατηγική γραμμή μεταξύ τμημάτων.',
    after: 'Κοινό operating model για CMO, growth teams και διοίκηση.',
  },
];

const operatingFlow = [
  { step: '01', title: 'Data foundation', description: 'Συγκεντρώνεις sales, προϊόντα και κανάλια σε ενιαία εικόνα.', icon: <LayoutDashboard size={18} /> },
  { step: '02', title: 'Commercial intelligence', description: 'RFM, segmentation και product scoring αποκαλύπτουν πού υπάρχει margin για growth.', icon: <Users size={18} /> },
  { step: '03', title: 'Activation strategy', description: 'Το σύστημα προτείνει προτεραιότητες για κανάλια, περιεχόμενο και εμπορικές κινήσεις.', icon: <Target size={18} /> },
  { step: '04', title: 'ROI governance', description: 'Μετράς επίδραση, επαναπροσαρμόζεις budget και βελτιστοποιείς με κύκλους υψηλής ταχύτητας.', icon: <Euro size={18} /> },
];

const valuePillars = [
  { title: 'Για τη Διοίκηση', description: 'Σαφές operating dashboard για revenue impact, margin signals και στρατηγικές προτεραιότητες.', icon: <BarChart3 size={18} /> },
  { title: 'Για το Marketing Team', description: 'Actionable κατεύθυνση ανά segment και καμπάνια, με λιγότερο trial-and-error.', icon: <Megaphone size={18} /> },
  { title: 'Για τον Οργανισμό', description: 'Κοινή γλώσσα αποφάσεων μεταξύ commercial, finance και marketing σε ένα σύστημα.', icon: <FileText size={18} /> },
];

const appPreviewPoints = [
  {
    title: 'Executive Dashboard Control',
    featureLabel: 'Dashboard',
    problem: 'Πρόβλημα: Η διοίκηση δεν έχει μία ενιαία, αξιόπιστη εικόνα για την εμπορική πορεία.',
    solution: 'Πώς το κάνει: Ενοποιεί KPIs, strategy και εμπορικά signals σε ένα dashboard.',
    value: 'Υπεραξία: Ταχύτερες αποφάσεις με κοινή γλώσσα για CEO, CMO και growth teams.',
    imageSrc: '/landing-screens/dashboard.png',
    imageClassName: 'object-left-top',
  },
  {
    title: 'Strategy Weights Intelligence',
    featureLabel: 'Strategy',
    problem: 'Πρόβλημα: Η προτεραιοποίηση προϊόντων/καναλιών γίνεται ad-hoc και όχι με δομημένα κριτήρια.',
    solution: 'Πώς το κάνει: Strategy weights configurator με multi-factor scoring logic.',
    value: 'Υπεραξία: Στόχευση budget σε κινήσεις με το μεγαλύτερο margin impact.',
    imageSrc: '/landing-screens/strategy-rfm.png',
    imageClassName: 'object-top',
  },
  {
    title: 'RFM Segmentation in Action',
    featureLabel: 'RFM Analysis',
    problem: 'Πρόβλημα: Το marketing στοχεύει οριζόντια χωρίς σαφή διαχωρισμό πελατών.',
    solution: 'Πώς το κάνει: RFM analysis που εντοπίζει υψηλής αξίας, loyal και at-risk segments.',
    value: 'Υπεραξία: Πιο έξυπνες καμπάνιες με μεγαλύτερη πιθανότητα conversion και retention.',
    imageSrc: '/landing-screens/strategy-rfm.png',
    imageClassName: 'object-bottom',
  },
];

const trustSignals = [
  { label: 'Enterprise-grade', icon: <Shield size={13} /> },
  { label: 'AI-native', icon: <Sparkles size={13} /> },
  { label: 'Firebase-secured', icon: <Lock size={13} /> },
  { label: 'Fast execution', icon: <Zap size={13} /> },
];

const variantCopy: Record<LandingVariant, {
  badge: string; headline: string; highlight: string; typewriterWords: string[];
  description: string; cta: string; uspTitle: string; uspPoints: string[];
  uspFooter: string; finalTitle: string; finalDescription: string;
}> = {
  ceo: {
    badge: 'Flagship platform for profitable growth',
    headline: 'Από τα data στο growth,',
    highlight: 'με AI στρατηγική που εκτελείται.',
    typewriterWords: ['που εκτελείται.', 'που αποδεικνύεται.', 'που κλιμακώνεται.'],
    description: 'Το Performance+ ενοποιεί marketing intelligence, product intelligence και ROI attribution ώστε η ομάδα σου να κινείται με σιγουριά στις αποφάσεις που αυξάνουν κέρδος.',
    cta: 'Start with Performance+',
    uspTitle: 'What makes it globally unique',
    uspPoints: [
      'Μετατρέπει sales data σε profit-first στρατηγική με operational βήματα.',
      'Συνδέει segmentation, προϊόντα και κανάλια σε ενιαία λογική απόφασης.',
      'Δίνει measurable impact μέσω ROI Attribution και AI Insights.',
    ],
    uspFooter: 'Για CEO, Founder, CMO και marketing teams που θέλουν κάθε καμπάνια να συνδέεται με measurable revenue impact.',
    finalTitle: 'Έτοιμο για growth teams που μετρούν αποτέλεσμα',
    finalDescription: 'Αν ο οργανισμός σου χρειάζεται marketing governance, υψηλή ταχύτητα αποφάσεων και σαφή σύνδεση performance με revenue, το Performance+ λειτουργεί ως operating system για την εμπορική σου ανάπτυξη.',
  },
  ops: {
    badge: 'Built for Marketing Ops velocity',
    headline: 'Λιγότερο reporting,',
    highlight: 'περισσότερες κινήσεις που αποδίδουν.',
    typewriterWords: ['που αποδίδουν.', 'που μετράνε.', 'που κλιμακώνονται.'],
    description: 'Το Performance+ δίνει σε marketing managers και performance teams ένα ενιαίο command center για segments, products, channels και content prioritization.',
    cta: 'Activate Marketing Ops Mode',
    uspTitle: 'Why Marketing Operations teams choose it',
    uspPoints: [
      'Μειώνει τον χρόνο από analysis σε execution με actionable AI recommendations.',
      'Ευθυγραμμίζει καμπάνιες, περιεχόμενο και budget σε κοινό KPI framework.',
      'Κάνει εύκολο το weekly optimization cycle με καθαρά insights ανά segment.',
    ],
    uspFooter: 'Ιδανικό για οργανισμούς που χρειάζονται alignment μεταξύ CMO, Growth και Performance Marketing.',
    finalTitle: 'Το operating layer του marketing τμήματος σου',
    finalDescription: 'Για teams που τρέχουν πολλά κανάλια ταυτόχρονα, το Performance+ προσφέρει κοινή ορατότητα, ταχύτερη λήψη αποφάσεων και σταθερή βελτιστοποίηση ROI.',
  },
};

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useTypewriter(words: string[], speed = 55, pause = 2200) {
  const [displayed, setDisplayed] = useState('');
  const [wordIdx, setWordIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const current = words[wordIdx];
    const delay = deleting ? speed / 2 : charIdx === current.length ? pause : speed;
    const timer = setTimeout(() => {
      if (!deleting && charIdx < current.length) {
        setDisplayed(current.slice(0, charIdx + 1));
        setCharIdx(c => c + 1);
      } else if (!deleting && charIdx === current.length) {
        setDeleting(true);
      } else if (deleting && charIdx > 0) {
        setDisplayed(current.slice(0, charIdx - 1));
        setCharIdx(c => c - 1);
      } else {
        setDeleting(false);
        setWordIdx(i => (i + 1) % words.length);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [words, wordIdx, charIdx, deleting, speed, pause]);

  return displayed;
}

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

// ─── Main Component ───────────────────────────────────────────────────────────

export function MarketingIndexPage({ onOpenAuth, variant = 'ceo', onVariantChange }: MarketingIndexPageProps) {
  const copy = variantCopy[variant];
  const typewritten = useTypewriter(copy.typewriterWords);

  // Sticky header / scroll state
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
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
      <header className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? 'shadow-[0_8px_24px_rgba(16,24,40,0.12)] bg-[var(--nts-bg-pure)]/95 backdrop-blur' : 'bg-transparent'}`}>
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4 md:px-10">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#1f2328]/30 bg-[var(--nts-bg-pure)] text-[#1f2328] shadow-sm">
              <Brain size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide text-[var(--nts-charcoal)]">Performance+</p>
              <p className="text-xs text-[var(--nts-medium-gray)]">by notthesame.ai</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* A/B variant toggle */}
            <div className="hidden items-center gap-1 md:flex">
              {(['ceo', 'ops'] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onVariantChange?.(v)}
                  className={`rounded-full px-3 py-1 text-xs transition ${variant === v ? 'bg-[#1f2328] text-white' : 'text-[var(--nts-medium-gray)] hover:text-[var(--nts-charcoal)]'}`}
                >
                  {v === 'ceo' ? 'CEO view' : 'Ops view'}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onOpenAuth}
              className={`rounded-xl border border-[var(--nts-accent-hover)] bg-[var(--nts-accent)] px-4 py-2 text-sm font-semibold text-white shadow-[0_6px_14px_rgba(249,115,22,0.35)] transition hover:bg-[var(--nts-accent-hover)] ${scrolled ? 'opacity-100' : 'opacity-90'}`}
            >
              Είσοδος →
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="mx-auto grid w-full max-w-7xl gap-10 px-6 pb-8 pt-6 md:px-10 md:pt-10 lg:grid-cols-2 lg:items-center">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#1f2328]/20 bg-[var(--nts-light-gray)] px-3 py-1 text-xs text-[var(--nts-medium-gray)]">
            <Sparkles size={13} className="text-[var(--nts-accent)]" />
            {copy.badge}
          </div>

          <h1 className="text-3xl font-semibold leading-tight text-[var(--nts-charcoal)] md:text-5xl">
            {copy.headline}
            <span className="mt-1 block text-[var(--nts-accent)]">
              {typewritten}
              <span className="ml-0.5 inline-block h-8 w-0.5 animate-pulse bg-[var(--nts-accent)] align-middle" />
            </span>
          </h1>

          <p className="max-w-xl text-base text-[var(--nts-medium-gray)] md:text-lg">
            {copy.description}
          </p>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={onOpenAuth}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--nts-accent)] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(249,115,22,0.35)] transition hover:bg-[var(--nts-accent-hover)]"
            >
              {copy.cta}
              <ArrowRight size={16} />
            </button>
          </div>
        </div>

        {/* USP card */}
        <div className="rounded-3xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)] md:p-8">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--nts-medium-gray)]">{copy.uspTitle}</p>
          <ul className="mt-5 space-y-3">
            {copy.uspPoints.map((point) => (
              <li key={point} className="flex items-start gap-2 rounded-xl border border-[#1f2328]/15 bg-[var(--nts-light-gray)] px-4 py-3 text-sm text-[var(--nts-charcoal)]">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--nts-accent)]" />
                {point}
              </li>
            ))}
          </ul>
          <p className="mt-5 rounded-xl border border-[var(--nts-accent)]/35 bg-[var(--nts-accent)]/8 px-4 py-3 text-sm text-[var(--nts-charcoal)]">
            {copy.uspFooter}
          </p>
        </div>
      </section>

      {/* ── Trust signal bar ─────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-7xl px-6 pb-6 md:px-10">
        <div className="flex flex-wrap items-center justify-center gap-6 rounded-2xl border border-[#1f2328]/15 bg-[var(--nts-light-gray)] px-6 py-3">
          {trustSignals.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5 text-xs font-medium text-[var(--nts-medium-gray)]">
              <span className="text-[#1f2328]">{s.icon}</span>
              {s.label}
            </div>
          ))}
        </div>
      </div>

      {/* ── Metrics strip ────────────────────────────────────────────────── */}
      <div ref={metricsRef} className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="grid divide-x divide-[#1f2328]/15 rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] shadow-[0_16px_32px_rgba(16,24,40,0.12)] md:grid-cols-3">
          {metrics.map((m) => (
            <MetricItem key={m.label} value={parseInt(m.value)} suffix={m.suffix} label={m.label} active={metricsVisible} />
          ))}
        </div>
      </div>

      {/* ── DNA block ────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_18px_40px_rgba(16,24,40,0.14)]">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">Το μοναδικό DNA του Performance+</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {[
              { title: 'One System, όχι πολλά disconnected εργαλεία', body: 'Strategy, segmentation, product priorities και channel actions λειτουργούν σε κοινό εμπορικό μοντέλο.' },
              { title: 'AI recommendations με business context', body: 'Οι προτάσεις δεν είναι generic: λαμβάνουν υπόψη margin, segment behavior και εμπορικές προτεραιότητες.' },
              { title: 'ROI accountability σε επίπεδο διοίκησης', body: 'Κάθε ενέργεια συνδέεται με measurable impact για να ξέρεις τι κλιμακώνεις και τι σταματάς.' },
            ].map((item) => (
              <article key={item.title} className="rounded-xl border border-[#1f2328]/20 bg-[var(--nts-bg-pure)] p-4">
                <p className="text-sm font-semibold text-[var(--nts-charcoal)]">{item.title}</p>
                <p className="mt-2 text-sm text-[var(--nts-medium-gray)]">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Core features ────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="grid gap-4 md:grid-cols-2">
          {coreFeatures.map((feature) => (
            <article
              key={feature.title}
              className="rounded-2xl border border-[#1f2328]/25 bg-[var(--nts-bg-pure)] p-5 shadow-[0_16px_30px_rgba(16,24,40,0.12)] transition duration-200 hover:-translate-y-1 hover:border-[var(--nts-accent)]/45 hover:shadow-[0_22px_40px_rgba(16,24,40,0.18)]"
            >
              <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#1f2328]/30 bg-[var(--nts-bg-pure)] text-[#1f2328]">
                {feature.icon}
              </div>
              <h3 className="text-base font-semibold text-[var(--nts-charcoal)]">{feature.title}</h3>
              <p className="mt-2 text-sm text-[var(--nts-medium-gray)]">{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Before / After problems ──────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)]">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">Ποια προβλήματα λύνει το Performance+</h3>

          {/* column headers */}
          <div className="mt-5 grid grid-cols-[1fr_1fr] gap-3 md:grid-cols-[auto_1fr_1fr]">
            <div className="hidden md:block" />
            <p className="rounded-t-xl bg-[var(--nts-light-gray)] px-4 py-2 text-center text-xs font-semibold uppercase tracking-wide text-[var(--nts-medium-gray)]">Χωρίς Performance+</p>
            <p className="rounded-t-xl bg-[var(--nts-accent)] px-4 py-2 text-center text-xs font-semibold uppercase tracking-wide text-white">Με Performance+</p>
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
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">Πώς το κάνει - από insight σε αποτέλεσμα</h3>
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
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">Τι υπεραξία προσφέρει στην πράξη</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {valuePillars.map((item) => (
              <article key={item.title} className="rounded-xl border border-[#1f2328]/20 bg-[var(--nts-bg-pure)] p-4">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#1f2328]/30 text-[#1f2328]">
                  {item.icon}
                </div>
                <h4 className="mt-3 text-sm font-semibold text-[var(--nts-charcoal)]">{item.title}</h4>
                <p className="mt-2 text-sm text-[var(--nts-medium-gray)]">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── App previews ──────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-[var(--nts-bg-pure)] p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)]">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">3 σημεία από το ίδιο το application interface</h3>
          <p className="mt-2 text-sm text-[var(--nts-medium-gray)]">
            Πραγματικά in-app views που δείχνουν πώς το Performance+ μεταφράζει intelligence σε εμπορική δράση.
          </p>

          <div className="mt-5 grid gap-5">
            {appPreviewPoints.map((point) => (
              <article key={point.title} className="rounded-xl border border-[#1f2328]/20 bg-[var(--nts-bg-pure)] p-4 shadow-[0_10px_24px_rgba(16,24,40,0.12)]">
                <div className="grid gap-4 md:grid-cols-[1.1fr_1fr] md:items-start">
                  <div>
                    <h4 className="text-sm font-semibold text-[var(--nts-charcoal)]">{point.title}</h4>
                    <p className="mt-2 text-xs text-[var(--nts-medium-gray)]">{point.problem}</p>
                    <p className="mt-1 text-xs text-[var(--nts-medium-gray)]">{point.solution}</p>
                    <p className="mt-1 text-xs font-medium text-[var(--nts-charcoal)]">{point.value}</p>
                  </div>

                  {/* Screenshot with zoom + overlay label on hover */}
                  <div className="group relative overflow-hidden rounded-lg border border-[#1f2328]/25 bg-[var(--nts-light-gray)]">
                    <img
                      src={point.imageSrc}
                      alt={`${point.title} screenshot`}
                      className={`h-52 w-full object-cover transition-transform duration-500 group-hover:scale-105 ${point.imageClassName}`}
                    />
                    {/* Anonymization masks */}
                    <div className="pointer-events-none absolute left-0 top-0 h-9 w-full bg-[var(--nts-bg-pure)]/85 backdrop-blur-[2px]" />
                    <div className="pointer-events-none absolute left-0 top-0 h-full w-12 bg-[var(--nts-bg-pure)]/80 backdrop-blur-[1px]" />
                    <div className="pointer-events-none absolute right-2 top-2 h-5 w-24 rounded bg-[var(--nts-bg-pure)]/90" />
                    <div className="pointer-events-none absolute left-2 top-2 h-5 w-20 rounded bg-[var(--nts-bg-pure)]/90" />
                    {/* Hover overlay label */}
                    <div className="pointer-events-none absolute inset-0 flex items-end opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                      <div className="w-full bg-[#1f2328]/80 px-4 py-2 backdrop-blur-sm">
                        <p className="text-xs font-semibold text-white">{point.featureLabel}</p>
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
              Ενεργοποίησε το workspace σου
              <ArrowRight size={16} />
            </button>
            <a
              href="mailto:hello@notthesame.ai?subject=Performance%2B%20Demo%20Request"
              className="inline-flex items-center gap-2 rounded-xl border border-[#1f2328] bg-[var(--nts-bg-pure)] px-5 py-3 text-sm font-semibold text-[#1f2328] transition hover:bg-[var(--nts-light-gray)]"
            >
              <HelpCircle size={16} />
              Ζήτησε demo / επικοινωνία
            </a>
          </div>

          <p className="mt-4 text-xs text-[var(--nts-medium-gray)]">
            Εναλλακτικά: email στο <span className="font-semibold text-[var(--nts-charcoal)]">hello@notthesame.ai</span> για enterprise onboarding, pricing ή custom εμπορικό setup.
          </p>
        </div>
      </section>

      {/* ── Footer brand tag ──────────────────────────────────────────────── */}
      <footer className="mx-auto w-full max-w-7xl px-6 pb-10 pt-2 md:px-10">
        <div className="flex items-center justify-between border-t border-[#1f2328]/10 pt-5">
          <div className="flex items-center gap-2 text-xs text-[var(--nts-medium-gray)]">
            <Brain size={13} className="text-[#1f2328]" />
            <span>Performance+ by <span className="font-semibold text-[var(--nts-charcoal)]">notthesame.ai</span></span>
          </div>
          <p className="text-xs text-[var(--nts-medium-gray)]">AI-Powered Marketing Intelligence</p>
        </div>
      </footer>

    </div>
  );
}
