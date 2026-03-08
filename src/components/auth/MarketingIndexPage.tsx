import { ArrowRight, BarChart3, Brain, Database, FileSpreadsheet, Megaphone, ShieldCheck, Target, TrendingUp, Upload, Users, Zap } from 'lucide-react';

interface MarketingIndexPageProps {
  onOpenAuth: () => void;
  variant?: 'ceo' | 'ops';
  onVariantChange?: (variant: 'ceo' | 'ops') => void;
}

const CALENDLY_URL = 'https://calendly.com/notthesame/performance-plus-demo';

const painPoints = [
  {
    icon: <Database size={20} />,
    title: 'Τα data σας είναι παντού',
    description: 'Analytics, Meta Ads, ERP, spreadsheets. Κάθε μήνα σπαταλάτε ώρες για να βγάλετε μια εικόνα.',
  },
  {
    icon: <Users size={20} />,
    title: 'Η ομάδα δεν ξέρει τι να εκτελέσει πρώτα',
    description: 'Ένα άτομο στο marketing, εξωτερικό agency, και κανένα κοινό πλαίσιο. Η εκτέλεση γίνεται στην τύχη.',
  },
  {
    icon: <TrendingUp size={20} />,
    title: 'Δεν βλέπετε ποια στρατηγική αποδίδει',
    description: 'Μετράτε clicks αντί για εμπορικά αποτελέσματα. Δεν ξέρετε αν η επένδυσή σας γυρνάει.',
  },
];

const pillars = [
  {
    step: '01',
    title: 'Data → Στρατηγική',
    description: 'AI ανάλυση πελατολογίου, αποθέματος και performance — αυτόματη πρόταση εμπορικής στρατηγικής.',
    icon: <Brain size={20} />,
  },
  {
    step: '02',
    title: 'Στρατηγική → Brief',
    description: 'Ένα click δημιουργεί Strategy Package με segments, κανάλια, budget — έτοιμο για αποστολή.',
    icon: <FileSpreadsheet size={20} />,
  },
  {
    step: '03',
    title: 'Brief → Εκτέλεση',
    description: 'Η ομάδα σας και το agency λαμβάνουν σαφείς κατευθύνσεις. Κοινή γλώσσα, μηδέν παρερμηνείες.',
    icon: <Megaphone size={20} />,
  },
  {
    step: '04',
    title: 'Εκτέλεση → Αποτελέσματα',
    description: 'ROI attribution, AI insights, μετρήσιμη απόδοση. Ξέρετε τι δουλεύει και τι αλλάζει.',
    icon: <BarChart3 size={20} />,
  },
];

const howItWorks = [
  {
    num: '1',
    title: 'Ανεβάστε τα data σας',
    description: 'ERP, Google Ads, Meta, CSV — σε λίγα λεπτά το σύστημα τα ενοποιεί.',
  },
  {
    num: '2',
    title: 'Λάβετε AI στρατηγική',
    description: 'Segments, κανάλια, budget allocation — εξατομικευμένα στο brand σας.',
  },
  {
    num: '3',
    title: 'Μοιραστείτε & εκτελέστε',
    description: 'PDF, link, brief — η ομάδα ξέρει τι να κάνει. Εσείς βλέπετε αποτελέσματα.',
  },
];

const testimonials = [
  {
    quote: '"Placeholder testimonial — θα συμπληρωθεί με πραγματικό quote."',
    name: 'Όνομα πελάτη',
    company: 'E-shop brand',
    role: 'Ιδιοκτήτης',
  },
  {
    quote: '"Placeholder testimonial — θα συμπληρωθεί με πραγματικό quote."',
    name: 'Όνομα πελάτη',
    company: 'E-shop brand',
    role: 'Marketing Manager',
  },
  {
    quote: '"Placeholder testimonial — θα συμπληρωθεί με πραγματικό quote."',
    name: 'Όνομα πελάτη',
    company: 'E-shop brand',
    role: 'Ιδιοκτήτης',
  },
];

const dataSources = [
  { name: 'ERP / Πωλήσεις', icon: <Database size={16} /> },
  { name: 'Google Ads', icon: <BarChart3 size={16} /> },
  { name: 'Meta Ads', icon: <Target size={16} /> },
  { name: 'CSV / Excel', icon: <FileSpreadsheet size={16} /> },
  { name: 'Data Import', icon: <Upload size={16} /> },
];

export function MarketingIndexPage({ onOpenAuth, variant: _variant, onVariantChange: _onVariantChange }: MarketingIndexPageProps) {
  void _variant;
  void _onVariantChange;

  return (
    <div className="h-screen overflow-y-auto overflow-x-hidden bg-white text-[#1A1A1A]">

      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-sm border-b border-[#F5F5F5]">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/favicon.png" alt="Performance+" className="h-7 w-7" />
            <span className="text-base font-bold text-[#1A1A1A] tracking-tight">Performance+</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onOpenAuth}
              className="text-sm text-[#4A4A4A] hover:text-[#1A1A1A] transition-colors"
            >
              Είσοδος
            </button>
            <a
              href={CALENDLY_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1A1A1A] px-4 py-2 text-sm font-medium text-white hover:bg-[#333] transition-colors"
            >
              Κλείστε Demo
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-20 md:pt-24 md:pb-28">
        <div className="max-w-3xl">
          <p className="text-sm font-medium text-[var(--nts-accent)] mb-4">Data-driven εμπορική στρατηγική για e-shops</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-[1.08] tracking-tight text-[#1A1A1A]">
            Η εμπορική στρατηγική του e-shop σας.
            <span className="block text-[#9CA3AF]">Σε ένα μέρος. Με AI.</span>
          </h1>
          <p className="mt-6 text-lg text-[#4A4A4A] leading-relaxed max-w-2xl">
            Ενοποιεί τα data σας, αναλύει πελάτες και προϊόντα, προτείνει στρατηγική και δημιουργεί ready-to-execute briefs για την ομάδα σας και τους συνεργάτες σας.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={CALENDLY_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[#1A1A1A] px-6 py-3 text-sm font-semibold text-white hover:bg-[#333] transition-colors shadow-sm"
            >
              Κλείστε Demo
              <ArrowRight size={16} />
            </a>
            <button
              onClick={onOpenAuth}
              className="inline-flex items-center gap-2 rounded-lg border border-[#E5E5E5] px-6 py-3 text-sm font-medium text-[#4A4A4A] hover:bg-[#FAFAFA] transition-colors"
            >
              Είσοδος στην εφαρμογή
            </button>
          </div>
        </div>

        {/* Data sources strip */}
        <div className="mt-16 flex flex-wrap items-center gap-4">
          <span className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Πηγές δεδομένων:</span>
          {dataSources.map(ds => (
            <div key={ds.name} className="flex items-center gap-1.5 text-xs text-[#4A4A4A]">
              <span className="text-[#9CA3AF]">{ds.icon}</span>
              {ds.name}
            </div>
          ))}
        </div>
      </section>

      {/* Pain Points */}
      <section className="bg-[#FAFAFA] border-y border-[#F5F5F5]">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <p className="text-sm font-medium text-[var(--nts-accent)] mb-2">Το πρόβλημα</p>
          <h2 className="text-2xl md:text-3xl font-bold text-[#1A1A1A] max-w-2xl">
            E-shops 2-15M. Μεγάλη ανάπτυξη, μικρή ομάδα, μηδέν strategic visibility.
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {painPoints.map(p => (
              <div key={p.title} className="p-6 rounded-xl bg-white border border-[#E5E5E5]">
                <div className="w-10 h-10 rounded-lg bg-[#F5F5F5] flex items-center justify-center text-[#4A4A4A] mb-4">
                  {p.icon}
                </div>
                <h3 className="text-base font-semibold text-[#1A1A1A] mb-2">{p.title}</h3>
                <p className="text-sm text-[#4A4A4A] leading-relaxed">{p.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Solution Pillars */}
      <section className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <p className="text-sm font-medium text-[var(--nts-accent)] mb-2">Η λύση</p>
        <h2 className="text-2xl md:text-3xl font-bold text-[#1A1A1A] max-w-2xl">
          Από τα data στην εκτέλεση. Σε 4 βήματα.
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {pillars.map(p => (
            <div key={p.step} className="p-5 rounded-xl border border-[#E5E5E5] hover:border-[#D4D4D4] transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-bold text-[var(--nts-accent)]">{p.step}</span>
                <span className="text-[#9CA3AF]">{p.icon}</span>
              </div>
              <h3 className="text-base font-semibold text-[#1A1A1A] mb-2">{p.title}</h3>
              <p className="text-sm text-[#4A4A4A] leading-relaxed">{p.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-[#1A1A1A]">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <p className="text-sm font-medium text-[var(--nts-accent)] mb-2">Πώς δουλεύει</p>
          <h2 className="text-2xl md:text-3xl font-bold text-white max-w-2xl">
            3 βήματα. Χωρίς πολυπλοκότητα.
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {howItWorks.map(s => (
              <div key={s.num} className="p-6 rounded-xl border border-white/10 bg-white/5">
                <span className="text-3xl font-bold text-[var(--nts-accent)]">{s.num}</span>
                <h3 className="text-lg font-semibold text-white mt-3 mb-2">{s.title}</h3>
                <p className="text-sm text-white/60 leading-relaxed">{s.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap gap-3">
            <a
              href={CALENDLY_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-[#1A1A1A] hover:bg-[#F5F5F5] transition-colors"
            >
              Κλείστε Demo
              <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </section>

      {/* Value proposition */}
      <section className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <div className="grid gap-8 md:grid-cols-2 items-center">
          <div>
            <p className="text-sm font-medium text-[var(--nts-accent)] mb-2">Γιατί Performance+</p>
            <h2 className="text-2xl md:text-3xl font-bold text-[#1A1A1A]">
              Στρατηγική εμπορική καθοδήγηση, powered by AI.
            </h2>
            <p className="mt-4 text-[#4A4A4A] leading-relaxed">
              Το Performance+ αντικαθιστά τον κατακερματισμό εργαλείων και reports με ένα ενιαίο σύστημα εμπορικής νοημοσύνης — εξατομικευμένο στο brand, τα προϊόντα και τους πελάτες σας.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-5 rounded-xl bg-[#FAFAFA] border border-[#E5E5E5]">
              <Zap size={18} className="text-[var(--nts-accent)] mb-2" />
              <p className="text-2xl font-bold text-[#1A1A1A]">7</p>
              <p className="text-xs text-[#4A4A4A] mt-1">Στρατηγικά σενάρια</p>
            </div>
            <div className="p-5 rounded-xl bg-[#FAFAFA] border border-[#E5E5E5]">
              <Target size={18} className="text-[var(--nts-accent)] mb-2" />
              <p className="text-2xl font-bold text-[#1A1A1A]">AI</p>
              <p className="text-xs text-[#4A4A4A] mt-1">Εξατομίκευση ανά brand</p>
            </div>
            <div className="p-5 rounded-xl bg-[#FAFAFA] border border-[#E5E5E5]">
              <Users size={18} className="text-[var(--nts-accent)] mb-2" />
              <p className="text-2xl font-bold text-[#1A1A1A]">1 click</p>
              <p className="text-xs text-[#4A4A4A] mt-1">Strategy → Brief → Agency</p>
            </div>
            <div className="p-5 rounded-xl bg-[#FAFAFA] border border-[#E5E5E5]">
              <BarChart3 size={18} className="text-[var(--nts-accent)] mb-2" />
              <p className="text-2xl font-bold text-[#1A1A1A]">ROI</p>
              <p className="text-xs text-[#4A4A4A] mt-1">Μετρήσιμα αποτελέσματα</p>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="bg-[#FAFAFA] border-y border-[#F5F5F5]">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <p className="text-sm font-medium text-[var(--nts-accent)] mb-2">Τι λένε οι πελάτες μας</p>
          <h2 className="text-2xl md:text-3xl font-bold text-[#1A1A1A]">
            Brands που δουλεύουν ήδη με Performance+
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {testimonials.map((t, i) => (
              <div key={i} className="p-6 rounded-xl bg-white border border-[#E5E5E5]">
                <p className="text-sm text-[#4A4A4A] leading-relaxed italic">{t.quote}</p>
                <div className="mt-4 pt-4 border-t border-[#F5F5F5]">
                  <p className="text-sm font-semibold text-[#1A1A1A]">{t.name}</p>
                  <p className="text-xs text-[#9CA3AF]">{t.role}, {t.company}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-[#1A1A1A]">
            Δείτε πώς δουλεύει για το δικό σας e-shop
          </h2>
          <p className="mt-4 text-[#4A4A4A] leading-relaxed">
            30 λεπτά. Χωρίς δέσμευση. Θα σας δείξουμε πώς μπορεί να λειτουργήσει η data-driven στρατηγική στην πράξη.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <a
              href={CALENDLY_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[#1A1A1A] px-8 py-3.5 text-sm font-semibold text-white hover:bg-[#333] transition-colors shadow-sm"
            >
              Κλείστε Demo
              <ArrowRight size={16} />
            </a>
          </div>
          <p className="mt-6 text-xs text-[#9CA3AF]">
            Ή στείλτε μας email στο <a href="mailto:support@notthesame.gr" className="font-medium text-[#4A4A4A] hover:underline">support@notthesame.gr</a>
          </p>
        </div>
      </section>

      {/* Trust bar */}
      <section className="border-t border-[#F5F5F5]">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <div className="flex flex-wrap items-center justify-center gap-6">
            {[
              { icon: <ShieldCheck size={14} />, text: 'GDPR-compliant' },
              { icon: <Brain size={14} />, text: 'EU AI Act compliant' },
              { icon: <Database size={14} />, text: 'Google Cloud / Firebase (EU)' },
            ].map(item => (
              <div key={item.text} className="flex items-center gap-1.5 text-[11px] text-[#9CA3AF]">
                <span className="text-[#4A4A4A]">{item.icon}</span>
                {item.text}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#F5F5F5]">
        <div className="mx-auto max-w-6xl px-6 py-6 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-[#9CA3AF]">
            <img src="/favicon.png" alt="" className="h-4 w-4" />
            <span>
              Performance+ by{' '}
              <a href="https://notthesame.gr" target="_blank" rel="noreferrer" className="font-medium text-[#4A4A4A] hover:underline">
                notthesame.ai
              </a>
            </span>
          </div>
          <a href="mailto:support@notthesame.gr" className="text-xs text-[#9CA3AF] hover:text-[#4A4A4A] transition-colors">
            support@notthesame.gr
          </a>
        </div>
      </footer>

    </div>
  );
}
