import { useRef } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, Boxes, Brain, CheckCircle2, ClipboardCheck, Database, ExternalLink, Gauge, HelpCircle, Layers3, Mail, Megaphone, PackageCheck, ShieldCheck, ShoppingBag, Store, TrendingUp, Upload } from 'lucide-react';
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

const primaryCtaClass =
  'inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--nts-accent-hover)] bg-[var(--nts-accent)] px-5 py-3 text-sm font-semibold !text-white shadow-[0_12px_28px_rgba(249,115,22,0.32)] transition duration-200 ease-out hover:-translate-y-0.5 hover:bg-[var(--nts-accent-hover)] hover:!text-white hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nts-accent)] active:translate-y-0';

const darkCtaClass =
  'inline-flex items-center justify-center gap-2 rounded-2xl border border-[#1f2328]/10 bg-[#111827] px-5 py-3 text-sm font-semibold !text-white shadow-[0_12px_28px_rgba(17,24,39,0.18)] transition duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#0f172a] hover:!text-white hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111827] active:translate-y-0';

const heroLeadParagraph =
  'Το Performance+ συνδέει τα δεδομένα σας - καταναλωτικά κοινά, προϊόντα, αποθέματα, ERP και διαφημιστικά κανάλια - σε ένα ενιαίο σύστημα ανάλυσης και λήψης αποφάσεων με τεχνητή νοημοσύνη. Δημιουργήθηκε από ανθρώπους του marketing και αναλυτές δεδομένων, και λειτουργεί ήδη εδώ και 4 χρόνια ως μεθοδολογία ανάπτυξης στοχευμένων προωθητικών ενεργειών με ισχυρά μετρήσιμα αποτελέσματα.';

const heroSupportingParagraphs = [
  'Τα περισσότερα e-shops επενδύουν καθημερινά σε διαφήμιση χωρίς να γνωρίζουν ποια προϊόντα αξίζει πραγματικά να προωθήσουν.',
  'Άλλα προϊόντα εμφανίζονται σε καμπάνιες ενώ έχουν περιορισμένο απόθεμα. Άλλα μένουν για μήνες στην αποθήκη χωρίς εμπορική αξιοποίηση. Και συχνά το marketing λειτουργεί αποκομμένα από το stock, την κερδοφορία και τη συνολική εμπορική στρατηγική της επιχείρησης.',
  'Το Performance+ δημιουργήθηκε για να ενώσει όλα αυτά τα δεδομένα σε ένα ενιαίο σύστημα αποφάσεων.',
  'Η ομάδα σας διατηρεί πάντα τον τελικό έλεγχο και τη στρατηγική κατεύθυνση. Το Performance+ λειτουργεί ως ένα intelligence layer που οργανώνει την πληροφορία, αναδεικνύει ευκαιρίες και βοηθά στη λήψη πιο αποδοτικών αποφάσεων.',
];

const heroProofPoints = [
  { label: 'Stock-aware campaigns', value: 'Προώθηση με βάση διαθεσιμότητα' },
  { label: 'Profit signals', value: 'Προτεραιότητες με εμπορικό περιθώριο' },
  { label: 'AI guidance', value: 'Καθαρή απόφαση για κανάλι και budget' },
];

const methodologySteps = [
  {
    title: 'Σύνδεση εμπορικών δεδομένων',
    description: 'Ενοποίηση ERP, e-shop, αποθέματος, προϊόντων, analytics και διαφημιστικών καναλιών σε κοινή εικόνα.',
    icon: <Layers3 size={18} />,
  },
  {
    title: 'Commercial scoring',
    description: 'Αξιολόγηση προϊόντων, κοινών και καναλιών με βάση ζήτηση, stock, περιθώριο, συμπεριφορά και ιστορική απόδοση.',
    icon: <Gauge size={18} />,
  },
  {
    title: 'Action plan με έλεγχο ομάδας',
    description: 'Μετατροπή των σημάτων σε προτάσεις budget, content, channel mix και προτεραιοποίησης, με την ομάδα να κρατά την τελική απόφαση.',
    icon: <ClipboardCheck size={18} />,
  },
];

const trustPosturePoints = [
  'Read-only πρόσβαση όπου απαιτείται',
  'Ασφαλής διαχείριση δεδομένων',
  'GDPR-conscious lead και connector flows',
  'AI decision-support, όχι αυτόνομη εκτέλεση',
];

const commerceUseCases = [
  {
    title: 'Stock clearance χωρίς τυφλό discounting',
    before: 'Dead stock και slow movers μένουν αόρατα ή προωθούνται μόνο με οριζόντιες εκπτώσεις.',
    action: 'Το Performance+ αναδεικνύει ποια προϊόντα χρειάζονται εμπορική ώθηση και σε ποια κοινά έχουν μεγαλύτερη πιθανότητα κίνησης.',
    outcome: 'Καλύτερη κυκλοφορία αποθέματος με πιο στοχευμένη προβολή και λιγότερη πίεση στο margin.',
  },
  {
    title: 'Budget allocation με stock και margin',
    before: 'Το budget πηγαίνει σε campaigns χωρίς σαφή εικόνα διαθεσιμότητας, κερδοφορίας ή εμπορικής προτεραιότητας.',
    action: 'Συνδυάζει spend, ROAS, προϊόντα, περιθώριο και αποθέματα για να δείξει πού αξίζει να κατευθυνθεί η επένδυση.',
    outcome: 'Πιο καθαρές αποφάσεις για κανάλι, κοινό και προϊόν πριν δεσμευτεί διαφημιστικό κόστος.',
  },
  {
    title: 'Product launch με audience targeting',
    before: 'Νέα προϊόντα λανσάρονται με γενική επικοινωνία, χωρίς σύνδεση με υπάρχοντα κοινά και εμπορικά σήματα.',
    action: 'Χαρτογραφεί segment ευκαιρίας, προτεινόμενα κανάλια και content direction με βάση το brand και τη ζήτηση.',
    outcome: 'Πιο γρήγορη εμπορική εκκίνηση με καλύτερη στόχευση και μετρήσιμη κατεύθυνση.',
  },
  {
    title: 'Profitability-first growth',
    before: 'Η αύξηση τζίρου συχνά μετριέται χωρίς επαρκή σύνδεση με profitability και πραγματική επιχειρησιακή δυνατότητα.',
    action: 'Μετατρέπει τα δεδομένα σε growth priorities που λαμβάνουν υπόψη margin, stock, ζήτηση και κανάλια.',
    outcome: 'Ανάπτυξη με καθαρότερη εμπορική λογική και λιγότερο χαμένο spend.',
  },
];

const authorityProofPoints = [
  {
    title: 'Μεθοδολογία τεσσάρων ετών',
    description: 'Η λογική του Performance+ έχει χτιστεί μέσα από πρακτική εφαρμογή σε στοχευμένες προωθητικές ενέργειες και εμπορική ανάλυση.',
  },
  {
    title: 'Marketing και data analysis μαζί',
    description: 'Το προϊόν δεν βλέπει μόνο dashboards. Συνδέει εμπορική κρίση, analytics, προϊόντα και κανάλια σε κοινό decision framework.',
  },
  {
    title: 'Ασφαλής ρόλος AI',
    description: 'Το AI λειτουργεί ως decision-support layer που εξηγεί, προτεραιοποιεί και προτείνει. Δεν αφαιρεί τον τελικό έλεγχο από την ομάδα.',
  },
];

const dataIntroSources = [
  {
    name: 'Διαφημιστικά κανάλια',
    description: 'Google Ads, Meta, TikTok και Merchant Center για spend, ROAS, conversions και price benchmarks.',
    examples: 'Google Ads · Meta · TikTok · Merchant',
    icon: <Megaphone size={18} />,
  },
  {
    name: 'Analytics & organic',
    description: 'Συμπεριφορά επισκεπτών, traffic sources, top pages, organic queries, CTR και visibility.',
    examples: 'GA4 · Search Console',
    icon: <BarChart3 size={18} />,
  },
  {
    name: 'E-commerce κανάλια',
    description: 'Παραγγελίες, προϊόντα, πελάτες, inventory και revenue από τα βασικά e-shop συστήματα.',
    examples: 'Shopify · WooCommerce · OpenCart · Magento',
    icon: <ShoppingBag size={18} />,
  },
  {
    name: 'ERP & λειτουργίες',
    description: 'Αποθέματα, τιμές, προϊόντα, πωλήσεις και λειτουργικά δεδομένα από ERP/operations συστήματα.',
    examples: 'Megaventory · SoftOne · Epsilon Net · Entersoft',
    icon: <Boxes size={18} />,
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
  { title: 'Profit Maximization', description: 'Έμφαση σε προϊόντα με υψηλό περιθώριο κέρδους.', signal: 'Margin-first' },
  { title: 'Stock Clearance', description: 'Διαχείριση dead stock και excess inventory.', signal: 'Inventory release' },
  { title: 'Brand Launch', description: 'Υποστήριξη νέων προϊόντων και νέων εμπορικών εισόδων.', signal: 'Launch growth' },
  { title: 'Revenue Push', description: 'Ενίσχυση πωλήσεων σε προϊόντα με υψηλή ζήτηση.', signal: 'Demand capture' },
  { title: 'Mixed Strategy', description: 'Συνδυασμός πολλαπλών στρατηγικών με προσαρμοσμένα βάρη.', signal: 'Balanced plan' },
  { title: 'Seasonal / Promotional', description: 'Υποστήριξη εκπτώσεων και εποχιακών ενεργειών με έλεγχο αποθέματος.', signal: 'Seasonal lift' },
  { title: 'Custom Strategy', description: 'Πλήρως προσαρμοσμένη στρατηγική στις ανάγκες του brand.', signal: 'Brand-specific' },
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

const PREMIUM_SECTION_CARD =
  'relative overflow-hidden rounded-[32px] border border-[#1f2328]/10 bg-[var(--nts-bg-pure)] p-6 shadow-[0_24px_60px_rgba(16,24,40,0.12)] md:p-8';

function trackMarketingEvent(action: string, params?: Record<string, string>) {
  if (typeof window === 'undefined') return;
  const analyticsWindow = window as Window & {
    dataLayer?: Array<Record<string, unknown>>;
    gtag?: (command: 'event', eventName: string, eventParams?: Record<string, unknown>) => void;
  };

  analyticsWindow.dataLayer?.push({
    event: 'performance_plus_marketing',
    action,
    ...(params || {}),
  });
  analyticsWindow.gtag?.('event', action, {
    event_category: 'marketing_page',
    ...(params || {}),
  });
}

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
        'relative overflow-hidden rounded-[28px] border p-5 shadow-[0_18px_44px_rgba(16,24,40,0.11)] md:p-6',
        dark ? 'border-white/10 bg-[#101319] text-white' : 'border-[#1f2328]/10 bg-[linear-gradient(145deg,#ffffff_0%,#fafafa_100%)] text-[var(--nts-charcoal)]'
      ].join(' ')}
    >
      <div className="pointer-events-none absolute left-0 top-0 h-1.5 w-full bg-[var(--nts-accent)]" />
      <div className="pointer-events-none absolute right-[-80px] top-[-80px] h-48 w-48 rounded-full bg-[var(--nts-accent)]/10 blur-3xl" />
      {hasImage ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.15fr)] lg:items-center xl:gap-10">
          <div className="space-y-4">{body}</div>
          <div className="relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-[24px] border border-[#1f2328]/10 bg-[#f3f4f6] p-3 shadow-inner">
            <img
              src={point.imageSrc}
              alt={`${point.title} screenshot`}
              className="h-auto max-h-[min(500px,54vh)] w-full rounded-[18px] object-contain shadow-[0_18px_44px_rgba(16,24,40,0.14)]"
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

  return (
    <div ref={scrollRef} className="h-screen overflow-y-auto overflow-x-hidden bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.12),transparent_34%),linear-gradient(180deg,#ffffff_0%,#f7f7f7_42%,#ffffff_100%)] text-[var(--nts-charcoal)]">

      {/* ── Sticky header ────────────────────────────────────────────────── */}
      <header className="relative z-20">
        <div className={`${LANDING_MAX} pt-5`}>
          <div className="rounded-[24px] border border-[#1f2328]/10 bg-white/88 px-4 py-3 shadow-[0_14px_34px_rgba(16,24,40,0.1)] backdrop-blur md:px-5">
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
                    className="rounded-xl border border-[var(--nts-accent-hover)] bg-[var(--nts-accent)] px-3 py-2 text-sm font-semibold text-white shadow-[0_6px_14px_rgba(249,115,22,0.35)] transition duration-200 ease-out hover:-translate-y-0.5 hover:bg-[var(--nts-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nts-accent)] active:translate-y-0 sm:px-4"
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
      <section className={`${LANDING_MAX} pb-7 pt-4 md:pt-5`}>
        <div className="relative overflow-hidden rounded-[40px] border border-[#1f2328]/10 bg-[linear-gradient(145deg,#ffffff_0%,#fff7ed_52%,#ffffff_100%)] px-5 py-6 shadow-[0_30px_80px_rgba(16,24,40,0.16)] sm:px-7 md:px-10 md:py-9 lg:px-12">
          <div className="pointer-events-none absolute right-[-120px] top-[-80px] h-80 w-80 rounded-full bg-[var(--nts-accent)]/18 blur-3xl" />
          <div className="pointer-events-none absolute bottom-[-140px] left-[-40px] h-96 w-96 rounded-full bg-[#111827]/8 blur-3xl" />
          <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[var(--nts-accent)]/40 to-transparent" />

          <div className="relative">
            <div className="grid gap-7 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-9 xl:gap-12">
              <div className="space-y-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-[var(--nts-accent)]/25 bg-white/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--nts-accent)] shadow-[0_8px_20px_rgba(249,115,22,0.08)]">
                  <TrendingUp size={13} aria-hidden />
                  Commerce intelligence για e-shops
                </div>
                <h1 className="max-w-none leading-[1.08] text-[var(--nts-charcoal)]">
                  <span className="block text-4xl font-bold tracking-[-0.04em] md:text-5xl lg:text-6xl">Performance+:</span>
                  <span className="mt-3 block text-2xl font-semibold tracking-[-0.02em] text-[var(--nts-accent)] md:text-3xl lg:text-[2.85rem]">{MARKETING_TAGLINE_HEADER}</span>
                </h1>
                <div className="max-w-none text-[15px] leading-7 text-[var(--nts-medium-gray)] md:text-[17px] md:leading-8 lg:pr-2">
                  <p>{heroLeadParagraph}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <a
                    href="#interest"
                    onClick={() => trackMarketingEvent('cta_click', { placement: 'hero' })}
                    className={primaryCtaClass}
                  >
                    <HelpCircle size={16} />
                    Ζητήστε demo
                    <ArrowRight size={15} aria-hidden />
                  </a>
                  <span className="inline-flex items-center gap-2 rounded-2xl border border-[#1f2328]/10 bg-white/70 px-4 py-3 text-sm font-semibold text-[var(--nts-charcoal)] shadow-[0_8px_20px_rgba(16,24,40,0.06)]">
                    <ShieldCheck size={16} className="text-[var(--nts-accent)]" aria-hidden />
                    Read-only connectors
                  </span>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-[28px] border border-[#1f2328]/10 bg-[#111827] p-2 shadow-[0_24px_60px_rgba(16,24,40,0.22)]">
                <div className="absolute left-5 top-5 z-10 rounded-full border border-white/12 bg-white/90 px-3 py-1 text-[11px] font-semibold text-[#111827] shadow-[0_8px_18px_rgba(0,0,0,0.16)]">
                  Strategy dashboard
                </div>
                <img
                  src="/landing-screens/commercial-strategy-hero.png"
                  alt="Performance+ Commercial Strategy dashboard"
                  className="h-auto w-full rounded-[22px] object-contain"
                />
              </div>
            </div>

            <div className="mt-7 grid gap-3 md:grid-cols-3">
              {heroProofPoints.map((point) => (
                <div key={point.label} className="rounded-2xl border border-[#1f2328]/10 bg-white/78 p-4 shadow-[0_10px_24px_rgba(16,24,40,0.08)] backdrop-blur">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--nts-accent)]">{point.label}</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[var(--nts-charcoal)]">{point.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {heroSupportingParagraphs.map((p, index) => (
                <div
                  key={p}
                  className="relative overflow-hidden rounded-2xl border border-[#1f2328]/10 bg-white/72 p-4 shadow-[0_8px_20px_rgba(16,24,40,0.07)] backdrop-blur"
                >
                  <div className="pointer-events-none absolute left-0 top-0 h-full w-1 bg-[var(--nts-accent)]/70" />
                  <p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-[var(--nts-accent)]">
                    {String(index + 1).padStart(2, '0')}
                  </p>
                  <p className="text-sm leading-7 text-[var(--nts-medium-gray)] md:text-[15px]">
                    {p}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Credibility / methodology ─────────────────────────────────────── */}
      <section className={`${LANDING_MAX} pb-8`}>
        <div className={PREMIUM_SECTION_CARD}>
          <div className="pointer-events-none absolute left-[-120px] top-[-120px] h-72 w-72 rounded-full bg-[var(--nts-accent)]/10 blur-3xl" />
          <div className="relative grid gap-7 lg:grid-cols-[0.95fr_1.25fr] lg:items-start">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--nts-accent)]">Credibility layer</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-[var(--nts-charcoal)] md:text-3xl">4 χρόνια μεθοδολογίας Performance+</h2>
              <p className="mt-4 text-sm leading-7 text-[var(--nts-medium-gray)] md:text-base">
                Το Performance+ στηρίζεται σε συγκεκριμένες μεθοδολογίες data analysis με ακαδημαϊκή τεκμηρίωση ως προς την ανάγνωση των δεδομένων. Η μεθοδολογία σχεδιασμού και εκπόνησης των προτεινόμενων προωθητικών ενεργειών στηρίζεται στην ανάδειξη προτεραιοτήτων με βάση τα αποθέματα και τις καταναλωτικές συνήθειες. Η λήψη εμπορικών αποφάσεων ακολουθεί ως μια φυσική συνέχεια και εξέλιξη.
              </p>
              <div className="mt-6 grid gap-2">
                {trustPosturePoints.map((point) => (
                  <div key={point} className="flex items-center gap-2 rounded-2xl border border-[#1f2328]/10 bg-[var(--nts-bg-subtle)] px-4 py-3 text-sm font-semibold text-[var(--nts-charcoal)]">
                    <ShieldCheck size={16} className="shrink-0 text-[var(--nts-accent)]" aria-hidden />
                    <span>{point}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4">
              {methodologySteps.map((step, index) => (
                <div key={step.title} className="relative overflow-hidden rounded-3xl border border-[#1f2328]/10 bg-[linear-gradient(145deg,#ffffff_0%,#fafafa_100%)] p-5 shadow-[0_12px_30px_rgba(16,24,40,0.08)]">
                  <div className="pointer-events-none absolute right-[-48px] top-[-48px] h-28 w-28 rounded-full bg-[var(--nts-accent)]/10 blur-2xl" />
                  <div className="relative flex gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#111827] text-white shadow-[0_10px_22px_rgba(17,24,39,0.18)]">
                      {step.icon}
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--nts-accent)]">Step {index + 1}</p>
                      <h3 className="mt-1 text-base font-semibold text-[var(--nts-charcoal)]">{step.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-[var(--nts-medium-gray)]">{step.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Από τα δεδομένα στη στρατηγική εικόνα ─────────────────────────── */}
      <section className={`${LANDING_MAX} pb-8`}>
        <div className={PREMIUM_SECTION_CARD}>
          <div className="pointer-events-none absolute right-[-120px] top-[-120px] h-72 w-72 rounded-full bg-[var(--nts-accent)]/10 blur-3xl" />
          <div className="relative grid gap-7 lg:grid-cols-[0.9fr_1.3fr] lg:items-start">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--nts-accent)]">Data ecosystem</p>
              <h3 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-[var(--nts-charcoal)] md:text-3xl">Διάφορες ροές δεδομένων, συγκεκριμένες εμπορικές αποφάσεις</h3>
              <p className="mt-4 text-sm leading-7 text-[var(--nts-medium-gray)] md:text-base">
                Το Performance+ συγκεντρώνει πληροφορίες από τα κρίσιμα σημεία του e-commerce και τις μετατρέπει σε κοινή εικόνα για προϊόντα, stock, κανάλια, ROAS και profitability.
              </p>
              <div className="mt-6 rounded-2xl border border-[var(--nts-accent)]/25 bg-[var(--nts-accent)]/8 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--nts-accent)] text-white shadow-[0_10px_22px_rgba(249,115,22,0.25)]">
                    <Upload size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--nts-charcoal)]">Γρήγορη ενεργοποίηση connectors</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--nts-medium-gray)] md:text-sm">Read-only όπου απαιτείται, με ασφαλή σύνδεση λογαριασμών και συγχρονισμό δεδομένων στο Performance+.</p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="grid gap-3 sm:grid-cols-2">
                {dataIntroSources.map((source) => (
                  <div key={source.name} className="group relative overflow-hidden rounded-3xl border border-[#1f2328]/10 bg-[linear-gradient(145deg,#ffffff_0%,#fafafa_100%)] p-5 shadow-[0_14px_34px_rgba(16,24,40,0.08)] transition hover:-translate-y-1 hover:border-[var(--nts-accent)]/35 hover:shadow-[0_22px_46px_rgba(16,24,40,0.13)]">
                    <div className="pointer-events-none absolute right-[-36px] top-[-36px] h-24 w-24 rounded-full bg-[var(--nts-accent)]/10 blur-2xl transition group-hover:bg-[var(--nts-accent)]/18" />
                    <div className="relative flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#111827] text-white shadow-[0_10px_22px_rgba(17,24,39,0.18)]">
                        {source.icon}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[var(--nts-charcoal)]">{source.name}</p>
                        <p className="mt-2 text-xs leading-5 text-[var(--nts-medium-gray)]">{source.description}</p>
                      </div>
                    </div>
                    <p className="relative mt-4 rounded-full border border-[#1f2328]/10 bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--nts-charcoal)]">
                      {source.examples}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-2 rounded-3xl border border-[#1f2328]/10 bg-[#111827] p-3 text-white shadow-[0_18px_44px_rgba(17,24,39,0.18)] sm:grid-cols-3">
                {['Σύνδεση δεδομένων', 'AI ανάλυση', 'Εμπορική απόφαση'].map((step, index) => (
                  <div key={step} className="flex items-center gap-2 rounded-2xl bg-white/7 px-3 py-3 text-xs font-semibold">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--nts-accent)] text-[11px] text-white">{index + 1}</span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-10 border-t border-[#1f2328]/10 pt-8">
            <p className="text-[11px] font-semibold tracking-[0.08em] text-[var(--nts-accent)]">Εμπορική νοημοσύνη μέσω AI</p>
            <p className="mt-3 text-sm leading-7 text-[var(--nts-medium-gray)] md:text-base">
              Η πλατφόρμα αναλύει τα δεδομένα και δημιουργεί στρατηγική καθοδήγηση σε πέντε βασικούς άξονες:
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {aiIntelligenceAxes.map((axis) => (
                <div key={axis.title} className="rounded-2xl border border-white/10 bg-[#12151b] px-4 py-4 text-left shadow-[0_12px_28px_rgba(15,17,21,0.16)]">
                  <p className="text-sm font-semibold text-white">{axis.title}</p>
                  <p className="mt-2 text-xs leading-relaxed text-white/70 md:text-sm">{axis.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Commerce use cases ────────────────────────────────────────────── */}
      <section className={`${LANDING_MAX} pb-8`}>
        <div className={PREMIUM_SECTION_CARD}>
          <div className="pointer-events-none absolute right-[-120px] top-[-120px] h-72 w-72 rounded-full bg-[var(--nts-accent)]/10 blur-3xl" />
          <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--nts-accent)]">E-shop owner use cases</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-[var(--nts-charcoal)] md:text-3xl">Πού δημιουργεί εμπορική αξία</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--nts-medium-gray)] md:text-base">
                Τα πιο συχνά σημεία όπου ένα e-shop χάνει απόδοση δεν είναι μόνο τα ads. Είναι η αποσύνδεση ανάμεσα σε προϊόντα, stock, margin, κοινά και κανάλια.
              </p>
            </div>
            <a
              href="#interest"
              onClick={() => trackMarketingEvent('cta_click', { placement: 'use_cases' })}
              className={darkCtaClass}
            >
              Επικοινωνήστε μαζί μας 2310.321625
              <ArrowRight size={15} aria-hidden />
            </a>
          </div>

          <div className="relative mt-7 grid gap-4 md:grid-cols-2">
            {commerceUseCases.map((useCase) => (
              <article key={useCase.title} className="overflow-hidden rounded-3xl border border-[#1f2328]/10 bg-[linear-gradient(145deg,#ffffff_0%,#fafafa_100%)] shadow-[0_14px_34px_rgba(16,24,40,0.08)]">
                <div className="border-b border-[#1f2328]/10 bg-[#111827] px-5 py-4 text-white">
                  <div className="flex items-center gap-3">
                    <Store size={18} className="text-[var(--nts-accent)]" aria-hidden />
                    <h3 className="text-base font-semibold">{useCase.title}</h3>
                  </div>
                </div>
                <div className="grid gap-3 p-5">
                  {[
                    ['Πριν', useCase.before],
                    ['Τι κάνει το Performance+', useCase.action],
                    ['Business outcome', useCase.outcome],
                  ].map(([label, text]) => (
                    <div key={label} className="rounded-2xl border border-[#1f2328]/10 bg-white p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--nts-accent)]">{label}</p>
                      <p className="mt-2 text-sm leading-6 text-[var(--nts-medium-gray)]">{text}</p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Γιατί ξεχωρίζει ──────────────────────────────────────────────── */}
      <section className={`${LANDING_MAX} pb-8`}>
        <div className="grid items-stretch gap-5 lg:grid-cols-[1fr_1fr] lg:gap-8">
          <div className="relative overflow-hidden rounded-[32px] border border-[#1f2328]/10 bg-[var(--nts-bg-pure)] p-6 shadow-[0_24px_56px_rgba(16,24,40,0.12)] md:p-8">
            <div className="pointer-events-none absolute right-[-90px] top-[-90px] h-56 w-56 rounded-full bg-[var(--nts-accent)]/10 blur-3xl" />
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

          <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#12151b] p-6 shadow-[0_24px_56px_rgba(15,17,21,0.22)] md:p-8">
            <div className="pointer-events-none absolute bottom-[-120px] right-[-80px] h-72 w-72 rounded-full bg-[var(--nts-accent)]/14 blur-3xl" />
            <p className="text-[11px] tracking-[0.08em] text-[var(--nts-accent)]">Στην πράξη</p>
            <h2 className="mt-4 text-xl font-semibold text-white md:text-2xl">Τι σημαίνει αυτό στην πράξη</h2>
            <ul className="mt-6 space-y-3">
              {practiceOutcomes.map((line) => (
                <li key={line} className="flex items-start gap-3 text-sm leading-6 text-white/76 md:text-[15px]">
                  <CheckCircle2 size={16} className="mt-1 shrink-0 text-[var(--nts-accent)]" aria-hidden />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── 7 σενάρια ───────────────────────────────────────────────────── */}
      <section className={`${LANDING_MAX} pb-8`}>
        <div className={PREMIUM_SECTION_CARD}>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--nts-accent)]">Strategy engine</p>
              <h3 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-[var(--nts-charcoal)] md:text-3xl">Τα 7 εμπορικά σενάρια</h3>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--nts-medium-gray)] md:text-base">
                Το Performance+ επιτρέπει στην επιχείρηση να συγκρίνει διαφορετικές στρατηγικές πριν δεσμεύσει budget. Οι προτάσεις προσαρμόζονται στο brand, στη ζήτηση και στα επίπεδα αποθέματος ανά SKU.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--nts-accent)]/20 bg-[var(--nts-accent)]/8 px-4 py-3 text-sm font-semibold text-[var(--nts-charcoal)]">
              Απόφαση πριν το spend
            </div>
          </div>
          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {commerceScenarios.map((s) => (
              <div key={s.title} className="group relative overflow-hidden rounded-3xl border border-[#1f2328]/10 bg-[linear-gradient(145deg,#ffffff_0%,#fafafa_100%)] p-5 shadow-[0_12px_30px_rgba(16,24,40,0.08)] transition hover:-translate-y-1 hover:shadow-[0_20px_44px_rgba(16,24,40,0.13)]">
                <div className="pointer-events-none absolute right-[-40px] top-[-40px] h-28 w-28 rounded-full bg-[var(--nts-accent)]/10 blur-2xl" />
                <p className="relative inline-flex rounded-full border border-[var(--nts-accent)]/20 bg-[var(--nts-accent)]/8 px-3 py-1 text-[11px] font-semibold text-[var(--nts-accent)]">{s.signal}</p>
                <p className="relative mt-4 text-sm font-semibold text-[var(--nts-charcoal)]">{s.title}</p>
                <p className="relative mt-2 text-xs leading-relaxed text-[var(--nts-medium-gray)] md:text-sm">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Ποια προβλήματα επιλύει ─────────────────────────────────────── */}
      <section className={`${LANDING_MAX} pb-8`}>
        <div className={PREMIUM_SECTION_CARD}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--nts-accent)]">Commerce pain points</p>
          <h3 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-[var(--nts-charcoal)] md:text-3xl">Ποια προβλήματα επιλύει</h3>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {problemsHowWeHelp.map((row, i) => (
              <div key={i} className="rounded-3xl border border-[#1f2328]/10 bg-[var(--nts-bg-subtle)] p-5 shadow-[0_10px_26px_rgba(16,24,40,0.07)]">
                <div className="flex gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#111827] text-xs font-semibold text-white">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--nts-medium-gray)]">Πρόβλημα</p>
                    <p className="mt-2 text-sm font-semibold leading-relaxed text-[var(--nts-charcoal)]">{row.problem}</p>
                    <div className="mt-4 rounded-2xl border border-[var(--nts-accent)]/18 bg-white p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--nts-accent)]">Πώς βοηθά το Performance+</p>
                      <p className="mt-2 text-sm leading-6 text-[var(--nts-charcoal)]">{row.helps}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Proof & authority ─────────────────────────────────────────────── */}
      <section className={`${LANDING_MAX} pb-8`}>
        <div className="relative overflow-hidden rounded-[34px] border border-white/10 bg-[#111827] p-6 text-white shadow-[0_28px_70px_rgba(17,24,39,0.26)] md:p-8">
          <div className="pointer-events-none absolute right-[-120px] top-[-120px] h-80 w-80 rounded-full bg-[var(--nts-accent)]/20 blur-3xl" />
          <div className="pointer-events-none absolute bottom-[-120px] left-[-80px] h-72 w-72 rounded-full bg-white/8 blur-3xl" />
          <div className="relative grid gap-7 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--nts-accent)]">Proof & authority</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-white md:text-3xl">Από marketing εμπειρία σε decision system</h2>
              <p className="mt-4 text-sm leading-7 text-white/72 md:text-base">
                Το Performance+ έχει σχεδιαστεί από ανθρώπους του marketing και αναλυτές δεδομένων, με στόχο να κάνει την εμπορική λογική πιο ορατή, επαναλήψιμη και μετρήσιμη για την ομάδα του e-shop.
              </p>
              <div className="mt-6 rounded-3xl border border-white/10 bg-white/8 p-5">
                <p className="text-sm font-semibold text-white">Measurable outcomes χωρίς υπερβολές</p>
                <p className="mt-2 text-sm leading-6 text-white/68">
                  Τα αποτελέσματα αξιολογούνται ανά brand με βάση διαθέσιμα δεδομένα, όπως αξιοποίηση αποθέματος, ποιότητα στόχευσης, καλύτερη προτεραιοποίηση προϊόντων και καθαρότερη κατανομή budget.
                </p>
              </div>
            </div>

            <div className="grid gap-4">
              {authorityProofPoints.map((point) => (
                <div key={point.title} className="rounded-3xl border border-white/10 bg-white/8 p-5 shadow-[0_14px_34px_rgba(0,0,0,0.12)]">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="mt-1 shrink-0 text-[var(--nts-accent)]" aria-hidden />
                    <div>
                      <h3 className="text-base font-semibold text-white">{point.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-white/68">{point.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 5 περιβάλλοντα ──────────────────────────────────────────────── */}
      <section className={`${LANDING_MAX} pb-8`}>
        <div className={PREMIUM_SECTION_CARD}>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--nts-accent)]">Product experience</p>
              <h3 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-[var(--nts-charcoal)] md:text-3xl">Τα 5 βασικά περιβάλλοντα του Performance+</h3>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--nts-medium-gray)] md:text-base">
                Πώς το Performance+ μετατρέπει δεδομένα και νοημοσύνη σε στοχευμένη εμπορική δράση για e-shop owners και ομάδες marketing.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-2xl border border-[#1f2328]/10 bg-[var(--nts-bg-subtle)] px-4 py-3 text-sm font-semibold text-[var(--nts-charcoal)]">
              <PackageCheck size={16} className="text-[var(--nts-accent)]" aria-hidden />
              Από insight σε action
            </div>
          </div>

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
        <div className="relative overflow-hidden rounded-[34px] border border-white/10 bg-[#111827] p-6 text-white shadow-[0_28px_70px_rgba(17,24,39,0.28)] md:p-8">
          <div className="pointer-events-none absolute right-[-110px] top-[-120px] h-80 w-80 rounded-full bg-[var(--nts-accent)]/20 blur-3xl" />
          <div className="pointer-events-none absolute bottom-[-120px] left-[-80px] h-72 w-72 rounded-full bg-white/8 blur-3xl" />
          <div className="relative grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--nts-accent)]">Ready for commerce growth</p>
              <h3 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-white md:text-3xl">{copy.finalTitle}</h3>
              <p className="mt-3 max-w-4xl text-sm leading-7 text-white/72 md:text-base">{copy.finalDescription}</p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
              <div className="grid gap-3 text-sm text-white/78">
                {['Σύνδεση δεδομένων', 'Εμπορική προτεραιοποίηση', 'Πιο καθαρή απόφαση budget'].map((line) => (
                  <div key={line} className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-[var(--nts-accent)]" aria-hidden />
                    <span>{line}</span>
                  </div>
                ))}
              </div>
              <a
                href="#interest"
                onClick={() => trackMarketingEvent('cta_click', { placement: 'final_cta' })}
                className={`${primaryCtaClass} mt-5 w-full`}
              >
                <HelpCircle size={16} />
                Ζητήστε demo
                <ArrowRight size={15} aria-hidden />
              </a>
            </div>
          </div>

          <p className="relative mt-5 text-xs text-white/58">
            Εναλλακτικά,{' '}
            <a
              href="#interest"
              onClick={() => trackMarketingEvent('cta_click', { placement: 'final_text_link' })}
              className="font-semibold text-white underline underline-offset-2 hover:text-[var(--nts-accent)]"
            >
              επικοινωνήστε μαζί μας 2310.321625
            </a>
            {' '}
            για εταιρική ένταξη, εμπορική πολιτική ή εξειδικευμένη προσαρμογή του AI-powered περιβάλλοντος αποφάσεων.
          </p>
        </div>
      </section>

      {/* ── Compliance trust bar ─────────────────────────────────────────── */}
      <section className={`${LANDING_MAX} pb-8`}>
        <div className="flex flex-wrap items-center justify-center gap-6 rounded-3xl border border-[#1f2328]/10 bg-white/78 px-6 py-4 shadow-[0_12px_30px_rgba(16,24,40,0.06)] backdrop-blur md:px-10">
          {[
            { icon: <ShieldCheck size={15} />, text: 'GDPR-compliant' },
            { icon: <Brain size={15} />, text: 'EU AI Act — limited risk, transparent AI' },
            { icon: <Database size={15} />, text: 'Secure data handling' },
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
            <span className="text-[var(--nts-medium-gray)]/40">·</span>
            <span className="shrink-0">2310.321625</span>
            <span className="text-[var(--nts-medium-gray)]/40">·</span>
            <span className="shrink-0">support@notthesame.gr</span>
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
                href="#interest"
                onClick={() => trackMarketingEvent('cta_click', { placement: 'footer_contact' })}
                className="inline-flex items-center gap-1.5 font-medium text-[var(--nts-charcoal)] hover:text-[var(--nts-accent)] hover:underline"
              >
                <Mail size={13} aria-hidden />
                Επικοινωνήστε μαζί μας 2310.321625
              </a>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}
