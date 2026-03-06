import { ArrowRight, BarChart3, Brain, Euro, FileText, HelpCircle, LayoutDashboard, Megaphone, Package, SlidersHorizontal, Sparkles, Target, Users } from 'lucide-react';

type LandingVariant = 'ceo' | 'ops';

interface MarketingIndexPageProps {
  onOpenAuth: () => void;
  variant?: LandingVariant;
  onVariantChange?: (variant: LandingVariant) => void;
}

const coreFeatures = [
  {
    title: 'Strategy Weights',
    description: 'Ρυθμίζει factors προτεραιοποίησης με τρόπο που ταιριάζει στο εμπορικό σου μοντέλο.',
    icon: <SlidersHorizontal size={18} />,
  },
  {
    title: 'RFM Analysis',
    description: 'Μετατρέπει raw δεδομένα σε εμπορικά χρήσιμα segments με ξεκάθαρες προτεραιότητες.',
    icon: <Users size={18} />,
  },
  {
    title: 'Product Prioritization',
    description: 'Κατατάσσει portfolio με multi-factor scoring για γρήγορες αποφάσεις growth.',
    icon: <Package size={18} />,
  },
  {
    title: 'Channel Activation',
    description: 'AI recommendations για τα επόμενα κανάλια και τις πιο αποδοτικές ενέργειες.',
    icon: <Megaphone size={18} />,
  },
];

const problemsSolved = [
  {
    title: 'Fragmented data & αποφάσεις με καθυστέρηση',
    description: 'Διασκορπισμένα reports, ασύνδετα εργαλεία και καθυστερημένο optimization.',
  },
  {
    title: 'Budget allocation χωρίς πραγματική απόδειξη απόδοσης',
    description: 'Δυσκολία να φανεί τι παράγει κέρδος ανά κανάλι, segment και προϊόν.',
  },
  {
    title: 'Marketing execution χωρίς κοινή στρατηγική γραμμή',
    description: 'Ασυνέπεια μεταξύ διοίκησης, marketing και εμπορικών στόχων.',
  },
];

const operatingFlow = [
  {
    step: '01',
    title: 'Data foundation',
    description: 'Συγκεντρώνεις sales, προϊόντα και κανάλια σε ενιαία εικόνα.',
    icon: <LayoutDashboard size={18} />,
  },
  {
    step: '02',
    title: 'Commercial intelligence',
    description: 'RFM, segmentation και product scoring αποκαλύπτουν πού υπάρχει margin για growth.',
    icon: <Users size={18} />,
  },
  {
    step: '03',
    title: 'Activation strategy',
    description: 'Το σύστημα προτείνει προτεραιότητες για κανάλια, περιεχόμενο και εμπορικές κινήσεις.',
    icon: <Target size={18} />,
  },
  {
    step: '04',
    title: 'ROI governance',
    description: 'Μετράς επίδραση, επαναπροσαρμόζεις budget και βελτιστοποιείς με κύκλους υψηλής ταχύτητας.',
    icon: <Euro size={18} />,
  },
];

const valuePillars = [
  {
    title: 'Για τη Διοίκηση',
    description: 'Σαφές operating dashboard για revenue impact, margin signals και στρατηγικές προτεραιότητες.',
    icon: <BarChart3 size={18} />,
  },
  {
    title: 'Για το Marketing Team',
    description: 'Actionable κατεύθυνση ανά segment και καμπάνια, με λιγότερο trial-and-error.',
    icon: <Megaphone size={18} />,
  },
  {
    title: 'Για τον Οργανισμό',
    description: 'Κοινή γλώσσα αποφάσεων μεταξύ commercial, finance και marketing σε ένα σύστημα.',
    icon: <FileText size={18} />,
  },
];

const appPreviewPoints = [
  {
    title: 'Executive Dashboard Control',
    problem: 'Πρόβλημα: Η διοίκηση δεν έχει μία ενιαία, αξιόπιστη εικόνα για την εμπορική πορεία.',
    solution: 'Πώς το κάνει: Ενοποιεί KPIs, strategy και εμπορικά signals σε ένα dashboard.',
    value: 'Υπεραξία: Ταχύτερες αποφάσεις με κοινή γλώσσα για CEO, CMO και growth teams.',
    imageSrc: '/landing-screens/dashboard.png',
    imageClassName: 'object-left-top',
  },
  {
    title: 'Strategy Weights Intelligence',
    problem: 'Πρόβλημα: Η προτεραιοποίηση προϊόντων/καναλιών γίνεται ad-hoc και όχι με δομημένα κριτήρια.',
    solution: 'Πώς το κάνει: Strategy weights configurator με multi-factor scoring logic.',
    value: 'Υπεραξία: Στόχευση budget σε κινήσεις με το μεγαλύτερο margin impact.',
    imageSrc: '/landing-screens/strategy-rfm.png',
    imageClassName: 'object-top',
  },
  {
    title: 'RFM Segmentation in Action',
    problem: 'Πρόβλημα: Το marketing στοχεύει οριζόντια χωρίς σαφή διαχωρισμό πελατών.',
    solution: 'Πώς το κάνει: RFM analysis που εντοπίζει υψηλής αξίας, loyal και at-risk segments.',
    value: 'Υπεραξία: Πιο έξυπνες καμπάνιες με μεγαλύτερη πιθανότητα conversion και retention.',
    imageSrc: '/landing-screens/strategy-rfm.png',
    imageClassName: 'object-bottom',
  },
];

const variantCopy: Record<
  LandingVariant,
  {
    badge: string;
    headline: string;
    highlight: string;
    description: string;
    cta: string;
    uspTitle: string;
    uspPoints: string[];
    uspFooter: string;
    finalTitle: string;
    finalDescription: string;
  }
> = {
  ceo: {
    badge: 'Flagship platform for profitable growth',
    headline: 'Από τα data στο growth,',
    highlight: 'με AI στρατηγική που εκτελείται.',
    description:
      'Το Performance+ ενοποιεί marketing intelligence, product intelligence και ROI attribution ώστε η ομάδα σου να κινείται με σιγουριά στις αποφάσεις που αυξάνουν κέρδος.',
    cta: 'Start with Performance+',
    uspTitle: 'What makes it globally unique',
    uspPoints: [
      'Μετατρέπει sales data σε profit-first στρατηγική με operational βήματα.',
      'Συνδέει segmentation, προϊόντα και κανάλια σε ενιαία λογική απόφασης.',
      'Δίνει measurable impact μέσω ROI Attribution και AI Insights.',
    ],
    uspFooter: 'Για CEO, Founder, CMO και marketing teams που θέλουν κάθε καμπάνια να συνδέεται με measurable revenue impact.',
    finalTitle: 'Έτοιμο για growth teams που μετρούν αποτέλεσμα',
    finalDescription:
      'Αν ο οργανισμός σου χρειάζεται marketing governance, υψηλή ταχύτητα αποφάσεων και σαφή σύνδεση performance με revenue, το Performance+ λειτουργεί ως operating system για την εμπορική σου ανάπτυξη.',
  },
  ops: {
    badge: 'Built for Marketing Ops velocity',
    headline: 'Λιγότερο reporting,',
    highlight: 'περισσότερες κινήσεις που αποδίδουν.',
    description:
      'Το Performance+ δίνει σε marketing managers και performance teams ένα ενιαίο command center για segments, products, channels και content prioritization.',
    cta: 'Activate Marketing Ops Mode',
    uspTitle: 'Why Marketing Operations teams choose it',
    uspPoints: [
      'Μειώνει τον χρόνο από analysis σε execution με actionable AI recommendations.',
      'Ευθυγραμμίζει καμπάνιες, περιεχόμενο και budget σε κοινό KPI framework.',
      'Κάνει εύκολο το weekly optimization cycle με καθαρά insights ανά segment.',
    ],
    uspFooter: 'Ιδανικό για οργανισμούς που χρειάζονται alignment μεταξύ CMO, Growth και Performance Marketing.',
    finalTitle: 'Το operating layer του marketing τμήματος σου',
    finalDescription:
      'Για teams που τρέχουν πολλά κανάλια ταυτόχρονα, το Performance+ προσφέρει κοινή ορατότητα, ταχύτερη λήψη αποφάσεων και σταθερή βελτιστοποίηση ROI.',
  },
};

export function MarketingIndexPage({ onOpenAuth, variant = 'ceo', onVariantChange }: MarketingIndexPageProps) {
  const copy = variantCopy[variant];

  return (
    <div className="h-screen overflow-y-auto overflow-x-hidden bg-white text-[var(--nts-charcoal)]">
      <div className="relative">
        <header className="relative mx-auto w-full max-w-7xl px-6 py-6 md:px-10">
          <div className="flex items-center justify-between rounded-2xl border border-[#1f2328] bg-white px-4 py-3 shadow-[0_12px_30px_rgba(16,24,40,0.12)]">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#1f2328]/30 bg-white text-[#1f2328]">
                <Brain size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold tracking-wide text-[var(--nts-charcoal)]">Performance+</p>
                <p className="text-xs text-[var(--nts-medium-gray)]">AI-Powered Marketing Intelligence</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenAuth}
              className="rounded-xl border border-[#e75b2d] bg-[#FF6B35] px-4 py-2 text-sm font-semibold text-white shadow-[0_6px_14px_rgba(255,107,53,0.35)] transition hover:bg-[#e75b2d]"
            >
              Είσοδος
            </button>
          </div>
        </header>

        <section className="relative mx-auto grid w-full max-w-7xl gap-10 px-6 pb-16 pt-6 md:px-10 md:pb-24 lg:grid-cols-2 lg:items-center">
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onVariantChange?.('ceo')}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  variant === 'ceo'
                    ? 'bg-[#FF6B35] text-white border border-[#e75b2d]'
                    : 'bg-white text-[var(--nts-medium-gray)] border border-[var(--nts-border-gray)] hover:border-[#FF6B35]/50'
                }`}
              >
                Variant A - CEO
              </button>
              <button
                type="button"
                onClick={() => onVariantChange?.('ops')}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  variant === 'ops'
                    ? 'bg-[#FF6B35] text-white border border-[#e75b2d]'
                    : 'bg-white text-[var(--nts-medium-gray)] border border-[var(--nts-border-gray)] hover:border-[#FF6B35]/50'
                }`}
              >
                Variant B - Marketing Ops
              </button>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#1f2328]/20 bg-[var(--nts-light-gray)] px-3 py-1 text-xs text-[var(--nts-medium-gray)]">
              <Sparkles size={14} className="text-[#FF6B35]" />
              {copy.badge}
            </div>
            <h1 className="text-3xl font-semibold leading-tight text-[var(--nts-charcoal)] md:text-5xl">
              {copy.headline}
              <span className="block text-[#FF6B35]">
                {copy.highlight}
              </span>
            </h1>
            <p className="max-w-xl text-base text-[var(--nts-medium-gray)] md:text-lg">
              {copy.description}
            </p>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={onOpenAuth}
                className="inline-flex items-center gap-2 rounded-xl bg-[#FF6B35] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(255,107,53,0.35)] transition hover:bg-[#e75b2d]"
              >
                {copy.cta}
                <ArrowRight size={16} className="text-white" />
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-[#1f2328] bg-white p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)] md:p-8">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--nts-medium-gray)]">{copy.uspTitle}</p>
            <ul className="mt-5 space-y-3">
              {copy.uspPoints.map((point) => (
                <li key={point} className="rounded-xl border border-[#1f2328]/20 bg-white px-4 py-3 text-sm text-[var(--nts-charcoal)]">
                  {point}
                </li>
              ))}
            </ul>
            <p className="mt-5 rounded-xl border border-[#FF6B35]/35 bg-[#FF6B35]/8 px-4 py-3 text-sm text-[var(--nts-charcoal)]">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#FF6B35] align-middle mr-2" />
              {copy.uspFooter}
            </p>
          </div>
        </section>
      </div>

      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-white p-6 shadow-[0_18px_40px_rgba(16,24,40,0.14)]">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">Το μοναδικό DNA του Performance+</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <article className="rounded-xl border border-[#1f2328]/20 bg-white p-4">
              <p className="text-sm font-semibold text-[var(--nts-charcoal)]">One System, όχι πολλά disconnected εργαλεία</p>
              <p className="mt-2 text-sm text-[var(--nts-medium-gray)]">Strategy, segmentation, product priorities και channel actions λειτουργούν σε κοινό εμπορικό μοντέλο.</p>
            </article>
            <article className="rounded-xl border border-[#1f2328]/20 bg-white p-4">
              <p className="text-sm font-semibold text-[var(--nts-charcoal)]">AI recommendations με business context</p>
              <p className="mt-2 text-sm text-[var(--nts-medium-gray)]">Οι προτάσεις δεν είναι generic: λαμβάνουν υπόψη margin, segment behavior και εμπορικές προτεραιότητες.</p>
            </article>
            <article className="rounded-xl border border-[#1f2328]/20 bg-white p-4">
              <p className="text-sm font-semibold text-[var(--nts-charcoal)]">ROI accountability σε επίπεδο διοίκησης</p>
              <p className="mt-2 text-sm text-[var(--nts-medium-gray)]">Κάθε ενέργεια συνδέεται με measurable impact για να ξέρεις τι κλιμακώνεις και τι σταματάς.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="grid gap-4 md:grid-cols-2">
          {coreFeatures.map((feature) => (
            <article
              key={feature.title}
              className="rounded-2xl border border-[#1f2328]/25 bg-white p-5 shadow-[0_16px_30px_rgba(16,24,40,0.12)] transition hover:-translate-y-0.5 hover:border-[#FF6B35]/45 hover:shadow-[0_22px_40px_rgba(16,24,40,0.18)]"
            >
              <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#1f2328]/30 bg-white text-[#1f2328]">
                {feature.icon}
              </div>
              <h3 className="text-base font-semibold text-[var(--nts-charcoal)]">{feature.title}</h3>
              <p className="mt-2 text-sm text-[var(--nts-medium-gray)]">{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 pb-8 pt-4 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-white p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)]">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">Ποια προβλήματα λύνει το Performance+</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {problemsSolved.map((item) => (
              <article key={item.title} className="rounded-xl border border-[#1f2328]/20 bg-white p-4">
                <h4 className="text-sm font-semibold text-[var(--nts-charcoal)]">{item.title}</h4>
                <p className="mt-2 text-sm text-[var(--nts-medium-gray)]">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-white p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)]">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">Πώς το κάνει - από insight σε αποτέλεσμα</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {operatingFlow.map((item) => (
              <article key={item.step} className="rounded-xl border border-[#1f2328]/20 bg-white p-4">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#1f2328]/30 text-[#1f2328]">
                    {item.icon}
                  </div>
                  <span className="text-xs font-semibold tracking-wide text-[#FF6B35]">{item.step}</span>
                </div>
                <h4 className="mt-3 text-sm font-semibold text-[var(--nts-charcoal)]">{item.title}</h4>
                <p className="mt-2 text-sm text-[var(--nts-medium-gray)]">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-white p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)]">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">Τι υπεραξία προσφέρει στην πράξη</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {valuePillars.map((item) => (
              <article key={item.title} className="rounded-xl border border-[#1f2328]/20 bg-white p-4">
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

      <section className="mx-auto w-full max-w-7xl px-6 pb-8 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-white p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)]">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">3 σημεία από το ίδιο το application interface</h3>
          <p className="mt-2 text-sm text-[var(--nts-medium-gray)]">
            Παρακάτω βλέπεις πραγματικά in-app views που δείχνουν πώς το Performance+ μεταφράζει intelligence σε εμπορική δράση.
          </p>

          <div className="mt-5 grid gap-5">
            {appPreviewPoints.map((point) => (
              <article key={point.title} className="rounded-xl border border-[#1f2328]/20 bg-white p-4 shadow-[0_10px_24px_rgba(16,24,40,0.12)]">
                <div className="grid gap-4 md:grid-cols-[1.1fr_1fr] md:items-start">
                  <div>
                    <h4 className="text-sm font-semibold text-[var(--nts-charcoal)]">{point.title}</h4>
                    <p className="mt-2 text-xs text-[var(--nts-medium-gray)]">{point.problem}</p>
                    <p className="mt-1 text-xs text-[var(--nts-medium-gray)]">{point.solution}</p>
                    <p className="mt-1 text-xs font-medium text-[var(--nts-charcoal)]">{point.value}</p>
                  </div>

                  <div className="relative overflow-hidden rounded-lg border border-[#1f2328]/25 bg-[var(--nts-light-gray)]">
                    <img
                      src={point.imageSrc}
                      alt={`${point.title} screenshot`}
                      className={`h-52 w-full object-cover ${point.imageClassName}`}
                    />

                    {/* Anonymization masks for client-sensitive UI areas */}
                    <div className="pointer-events-none absolute left-0 top-0 h-9 w-full bg-white/85 backdrop-blur-[2px]" />
                    <div className="pointer-events-none absolute left-0 top-0 h-full w-12 bg-white/80 backdrop-blur-[1px]" />
                    <div className="pointer-events-none absolute right-2 top-2 h-5 w-24 rounded bg-white/90" />
                    <div className="pointer-events-none absolute left-2 top-2 h-5 w-20 rounded bg-white/90" />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 pb-20 md:px-10">
        <div className="rounded-2xl border border-[#1f2328] bg-white p-6 shadow-[0_20px_44px_rgba(16,24,40,0.14)]">
          <h3 className="text-lg font-semibold text-[var(--nts-charcoal)]">{copy.finalTitle}</h3>
          <p className="mt-2 max-w-3xl text-sm text-[var(--nts-medium-gray)]">
            {copy.finalDescription}
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onOpenAuth}
              className="inline-flex items-center gap-2 rounded-xl bg-[#FF6B35] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(255,107,53,0.35)] transition hover:bg-[#e75b2d]"
            >
              Ενεργοποίησε το workspace σου
              <ArrowRight size={16} className="text-white" />
            </button>
            <a
              href="mailto:hello@notthesame.ai?subject=Performance%2B%20Demo%20Request"
              className="inline-flex items-center gap-2 rounded-xl border border-[#1f2328] bg-white px-5 py-3 text-sm font-semibold text-[#1f2328] transition hover:bg-[var(--nts-light-gray)]"
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
    </div>
  );
}
