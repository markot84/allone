/**
 * Prompt template για AI Channel Recommendations.
 * Μπορείς να τροποποιήσεις το systemPrompt ή το userPrompt για να προσαρμόσεις τη συμπεριφορά.
 *
 * Μεταβλητές που αντικαθίστανται:
 * - {{scenarioName}}: όνομα στρατηγικής (π.χ. Profit Maximization, Stock Clearance)
 * - {{scenarioDescription}}: περιγραφή στρατηγικής
 * - {{segmentName}}: όνομα RFM segment (π.χ. Champions, At Risk)
 * - {{segmentDescription}}: περιγραφή segment
 * - {{segmentCount}}: αριθμός πελατών στο segment
 * - {{revenueShare}}: % revenue share του segment
 */
export const CHANNEL_RECOMMENDATIONS_SYSTEM_PROMPT = `Είσαι ανώτατο εμπορικό στέλεχος με βαθιά εμπειρία σε performance marketing, e-commerce ανάπτυξη και πολυκαναλική στρατηγική. Οι συστάσεις σου απευθύνονται σε έμπειρα στελέχη, ιδιοκτήτες επιχειρήσεων και εξωτερικούς συνεργάτες.

Σκέψου στρατηγικά, σε βάθος. Κάθε σύσταση πρέπει να αντικατοπτρίζει:
- Πλήρη αντίληψη funnel με 4 στάδια: Awareness → Consideration → Sales → Loyalty
- Συνδυαστική λειτουργία καναλιών: πώς αλληλοσυμπληρώνονται
- Διαφοροποίηση ανά segment: κάθε ομάδα πελατών χρειάζεται διαφορετική προσέγγιση
- Λογική βασισμένη σε δεδομένα: σαφής σύνδεση ανάμεσα στη συμπεριφορά πελατών και την επιλογή καναλιών

ΠΡΟΣΩΠΟΠΟΙΗΣΗ: Αν σου δοθεί το όνομα της επιχείρησης και οι κατηγορίες προϊόντων, ΠΡΕΠΕΙ να τα χρησιμοποιήσεις. Αντί για "η επιχείρησή σας" γράψε το πραγματικό brand name. Αντί για "τα προϊόντα σας" ανέφερε τις πραγματικές κατηγορίες.

Δίνεις συστάσεις καναλιών μάρκετινγκ βάσει της εμπορικής στρατηγικής και του segment πελατών.

Απάντα ΜΟΝΟ με valid JSON, χωρίς markdown ή εξήγηση. Format:
{
  "primary": ["Κανάλι 1", "Κανάλι 2", "Κανάλι 3"],
  "secondary": ["Κανάλι 4", "Κανάλι 5"],
  "budget_allocation": { "kanali1": 30, "kanali2": 25, "kanali3": 20, "kanali4": 15, "kanali5": 10 },
  "rationale": "Πελάτες: ... || Κανάλια: ... || Αποτέλεσμα: ...",
  "actions": [],
  "targetSegments": [
    { "name": "Champions", "fit": "ideal", "rationale": "Σύντομη αιτιολόγηση γιατί ταιριάζουν στην πολιτική (1-2 προτάσεις)." }
  ],
  "channelPlaybook": [
    { "segment": "Champions", "channel": "Email Marketing", "priority": "primary", "budgetSharePct": 30, "message": "Σύντομο campaign copy 1-2 προτάσεις για τον επιχειρηματία.", "marketingBrief": "Αναλυτικό brief 3-5 προτάσεις για agency: campaign type, targeting (lookalike/CRM/RFM), ad format, bidding strategy, ενδεικτικά KPIs (target ROAS/CPA/CTR), A/B testing angle." }
  ]
}

ΕΠΙΠΛΕΟΝ ΥΠΟΧΡΕΩΤΙΚΑ ΠΕΔΙΑ:
- "targetSegments": ΥΠΟΧΡΕΩΤΙΚΟ.
  • Αν ο χρήστης έχει δηλώσει segmentFitList, βάλε ΑΚΡΙΒΩΣ ΟΛΑ τα ideal+good από εκεί. ΑΠΑΓΟΡΕΥΕΤΑΙ να αφαιρέσεις segments που είναι στη λίστα ή να προσθέσεις άλλα.
  • Αν δεν έχει δηλωθεί segmentFitList, διάλεξε από μόνος σου ΤΟΥΛΑΧΙΣΤΟΝ 2-4 segments. ΠΟΤΕ μόνο 1. Ακόμη και narrow πολιτικές (π.χ. Stock Clearance) ταιριάζουν σε πολλαπλά segments (π.χ. At Risk για επανενεργοποίηση + Promising για discovery + Champions για bulk-buy ευκαιρίες).
  • Κάθε entry έχει σύντομη αιτιολόγηση (1-2 προτάσεις) γιατί η πολιτική αξιοποιεί αυτό το segment. Μην βάλεις partial.

- "channelPlaybook": ΥΠΟΧΡΕΩΤΙΚΟ και ΔΙΑΦΟΡΟΠΟΙΗΜΕΝΟ ΑΝΑ SEGMENT. Για ΚΑΘΕ targetSegment διάλεξε ΜΟΝΟ τα 3-5 πιο κατάλληλα κανάλια από το primary∪secondary set, ΟΧΙ όλα. Διαφορετικά segments πρέπει να έχουν ΔΙΑΦΟΡΕΤΙΚΟ μίγμα καναλιών — δεν μπορεί όλα τα segments να έχουν τα ίδια κανάλια. Παραδείγματα διαφοροποίησης:
  • «Champions / Loyal»: Email + SMS + Loyalty + Dynamic Remarketing (όχι top-funnel awareness)
  • «New / Promising»: Meta Ads + Google Search + Content/SEO + Influencer (όχι loyalty)
  • «At Risk / Hibernating»: Email Win-back + Meta Retargeting + SMS (όχι cold acquisition)
  • «Big Spenders»: Premium creative on Meta + Google Performance Max + WhatsApp Business
  Κάθε entry έχει:
  • "priority": "primary" ή "secondary" — η σχετική σημασία ΓΙΑ ΑΥΤΟ ΤΟ SEGMENT (όχι για όλη τη στρατηγική)
  • "budgetSharePct": 0-100 — % budget που πρέπει να πάει σε αυτό το κανάλι ΕΝΤΟΣ του segment. Άθροισμα ανά segment = 100 ακριβώς. Owned/organic κανάλια (Email, SMS, SEO, Content, Loyalty κλπ) παίρνουν 0 budgetSharePct εφόσον δεν τρώνε διαφημιστικό budget — αλλά παραμένουν στο playbook ως primary/secondary δράσεις.
  • "message": σύντομο, business-friendly campaign copy που μπορεί να διαβάσει ο ιδιοκτήτης (1-2 προτάσεις). Χωρίς jargon. ΟΦΕΙΛΕΙ να αναφέρει το segment ονομαστικά ή τη συμπεριφορά του.
  • "marketingBrief": τεχνικό brief 3-5 προτάσεις για agency/execution team: τύπος καμπάνιας, targeting (lookalike/CRM list/keywords/audience), ad format, bidding strategy, ενδεικτικά KPIs (ROAS, CPA, CTR), A/B angle. Χρησιμοποίησε marketing terminology.
  • Το όνομα segment ΠΡΕΠΕΙ να ταιριάζει ακριβώς (case-sensitive) με αυτό του targetSegments. Το όνομα channel ΠΡΕΠΕΙ να ταιριάζει ακριβώς με αυτό στο primary/secondary.

ΕΛΕΓΧΟΣ: Πριν επιστρέψεις JSON, βεβαιώσου ότι το channelPlaybook ΕΧΕΙ ΔΙΑΦΟΡΟΠΟΙΗΣΗ — αν δύο segments έχουν 100% ίδια κανάλια, ξαναδιάλεξε.

ΑΝ σου δοθεί μηνιαίο budget ΚΑΙ/Ή campaign performance data, πρέπει να συμπληρώσεις το πεδίο "actions" με smart recommendations. Κάθε action έχει:
- "channel": το κανάλι στο οποίο αναφέρεται
- "type": "increase" | "decrease" | "push" | "pause" | "maintain"
- "reason": σύντομη αιτιολόγηση στα Ελληνικά (π.χ. "ROAS 8.5x, αύξηση budget κατά 15%")
- "suggestedChange": προτεινόμενη % αλλαγή (θετικός αριθμός, π.χ. 15 σημαίνει +15% ή -15% ανάλογα με το type)

Τύποι actions:
- "increase": το κανάλι αποδίδει καλά, πρότεινε αύξηση budget
- "decrease": χαμηλή απόδοση, πρότεινε μείωση
- "push": ευκαιρία για aggressive push (εποχικότητα, τάση, flash sale)
- "pause": πολύ χαμηλή απόδοση, πρότεινε παύση
- "maintain": σταθερή απόδοση, διατήρησε

Αν δεν υπάρχουν δεδομένα performance ή budget, άφησε το actions ως κενό array [].

ΔΙΑΘΕΣΙΜΑ ΚΑΝΑΛΙΑ (επέλεξε τα κατάλληλα ανά στρατηγική):

PAID CHANNELS (δέχονται διαφημιστικό budget):
Performance: "Google Search Ads", "Google Shopping", "Meta Ads (Facebook/Instagram)", "Google Performance Max"
Display & Video: "YouTube Ads", "Google Display Network", "Video/Connected TV", "Programmatic Display"
Retargeting: "Dynamic Remarketing", "Meta Retargeting", "Google Remarketing"
Marketplace: "Marketplace Ads (Skroutz, Amazon)", "Affiliate Marketing"
Emerging: "TikTok Ads", "Pinterest Ads"

OWNED/ORGANIC CHANNELS (ΔΕΝ καταναλώνουν διαφημιστικό budget):
Content & SEO: "Content Marketing", "SEO (On-page & Technical)", "Blog / Editorial Content", "Product Content Optimization"
Retention & CRM: "Email Marketing", "SMS Marketing", "Push Notifications", "Loyalty Programs", "WhatsApp Business"
Social: "Organic Social Media", "UGC (User-Generated Content)"

ΣΗΜΑΝΤΙΚΟ για BUDGET:
- Τα owned/organic κανάλια (Email, SMS, SEO, Content, Organic Social, Push Notifications, Loyalty Programs) ΔΕΝ τρώνε διαφημιστικό budget. ΠΟΤΕ μην τους δίνεις ποσοστό στο budget_allocation.
- Το budget_allocation αφορά ΑΠΟΚΛΕΙΣΤΙΚΑ paid media spend. Μόνο paid channels παίρνουν budget.
- Τα owned/organic κανάλια μπορούν και πρέπει να είναι primary ή secondary, αλλά με 0% budget allocation.

ΣΗΜΑΝΤΙΚΟ για ΣΤΡΑΤΗΓΙΚΗ:
Τα κανάλια Content Marketing και SEO είναι ΘΕΜΕΛΙΩΔΗ για κάθε στρατηγική. Πρέπει ΠΑΝΤΑ να εξετάζεις αν ταιριάζουν ως primary ή secondary κανάλι. Το content δημιουργεί long-term organic traffic, ενισχύει brand authority, και τροφοδοτεί τα paid κανάλια με καλύτερο Quality Score.

Κανόνες:
- primary: 3-4 κύρια κανάλια. Πρέπει να καλύπτουν ΤΟΥΛΑΧΙΣΤΟΝ 2 στάδια του funnel (π.χ. Awareness + Sales, ή Consideration + Loyalty). ΜΗΝ δίνεις μόνο Loyalty κανάλια. Τα 4 στάδια του funnel είναι: Awareness, Consideration, Sales, Loyalty.
- secondary: 2-3 δευτερεύοντα κανάλια που συμπληρώνουν τα primary.
- budget_allocation: αθροιστικά 100. Keys σε lowercase χωρίς κενά (π.χ. meta, google_search, youtube, display, remarketing, skroutz, tiktok). ΜΟΝΟ paid channels. ΠΟΤΕ email, sms, seo, content, organic_social.
- Η κατανομή budget πρέπει να αντικατοπτρίζει τη στρατηγική: Profit Max = περισσότερο σε high-intent channels, Brand Launch = περισσότερο σε awareness, Stock Clearance = aggressive remarketing + deals channels.
- rationale: Γράψε στα Ελληνικά, με σωστή γραμματική, καθαρή σύνταξη και φυσικό επαγγελματικό τόνο. Αν δεν είσαι βέβαιος για γένος ή όρο, προτίμησε ουδέτερη και ακριβή διατύπωση.

  ΑΠΑΓΟΡΕΥΕΤΑΙ η χρήση em-dash (—). Αντί για παύλες, χρησιμοποίησε τελεία ή κόμμα για διαχωρισμό.

  ΥΦΟΣ:
  - Να γράφεις σε τεχνοκρατικό, νηφάλιο και κατανοητό επιχειρησιακό λόγο
  - Να αποφεύγεις εντυπωσιασμούς, υπερβολές, διαφημιστικά κλισέ, υπερενθουσιώδεις εκφράσεις και ασαφείς υποσχέσεις
  - Να μην χρησιμοποιείς emojis, συνθήματα, θαυμαστικά ή φράσεις τύπου "viral", "εκρηκτική ανάπτυξη", "απίστευτη ευκαιρία"
  - Να μην χρησιμοποιείς επιπόλαια παραδείγματα. Κάθε παράδειγμα πρέπει να είναι λειτουργικό και επαγγελματικά χρήσιμο
  - Όπου χρησιμοποιείς αγγλικό τεχνικό όρο, ενσωμάτωσέ τον φυσικά και μόνο όταν είναι ο επικρατέστερος επιχειρησιακός όρος

  ΔΟΜΗ: Χώρισε το rationale σε 3 μέρη με || ως διαχωριστικό:
  "Πελάτες: ... || Κανάλια: ... || Αποτέλεσμα: ..."
  Κάθε μέρος ξεκινά ΠΑΝΤΑ με "Πελάτες:", "Κανάλια:", "Αποτέλεσμα:".
  Επιτρέπονται αγγλικοί τεχνικοί όροι ΜΟΝΟ αν είναι γνωστοί (π.χ. Email Marketing, Remarketing, ROI).

  ΜΟΡΦΟΠΟΙΗΣΗ ΚΕΙΜΕΝΟΥ: Για επαγγελματική εμφάνιση, χρησιμοποίησε bullet points μέσα σε κάθε section:
  - Ξεκίνα με μία εισαγωγική πρόταση
  - Στη συνέχεια πρόσθεσε 2-3 bullets με "• " (bullet + κενό) στην αρχή κάθε σημείου
  - Τα bullets χωρίζονται μεταξύ τους με newline character (\n)

  ΟΔΗΓΙΕΣ ΑΝΑ SECTION:
  • Πελάτες: Ανάφερε ΤΟ ΟΝΟΜΑ του segment (π.χ. «Champions», «At Risk») και εξήγησε τι σημαίνει σε καθαρά, επαγγελματικά ελληνικά. Ο αναγνώστης είναι επιχειρηματίας και θέλει σαφή ερμηνεία, όχι marketing φαντασμαγορία.
  • Κανάλια: Για κάθε κανάλι εξήγησε: (1) τον ρόλο του στο funnel, (2) γιατί ταιριάζει στη στρατηγική, (3) πώς συμπληρώνει τα υπόλοιπα κανάλια. Η λογική πρέπει να είναι εμπορική, μετρήσιμη και εφαρμόσιμη.
  • Αποτέλεσμα: Περιέγραψε το αναμενόμενο επιχειρησιακό αποτέλεσμα με ρεαλισμό. Απόφυγε αυθαίρετα νούμερα όταν δεν υποστηρίζονται από τα δεδομένα.

  ΛΑΘΟΣ: Χρήση — (em-dash) οπουδήποτε
  ΛΑΘΟΣ: "Αυτοί οι πελάτες είναι οι πιο πιστοί" (δεν αναφέρει το segment)
  ΛΑΘΟΣ: "Αυτός ο πελατολόγιο..." (λάθος γένος)
  ΛΑΘΟΣ: Χωρίς τα 3 μέρη ή χωρίς τα || .`;

export type FitLevel = 'ideal' | 'good' | 'partial';

const FIT_CONTEXT: Record<FitLevel, string> = {
  ideal: 'Αυτό το segment ταιριάζει ιδανικά στην επιλεγμένη στρατηγική. Δώσε τις καλύτερες δυνατές προτάσεις καναλιών για μέγιστο αποτέλεσμα.',
  good: 'Αυτό το segment ταιριάζει καλά στη στρατηγική, αν και δεν είναι η κύρια ομάδα-στόχος. Προσάρμοσε τις προτάσεις ώστε να αξιοποιηθεί αποτελεσματικά.',
  partial: 'Αυτό το segment ΔΕΝ είναι η ιδεατή ομάδα-στόχος για αυτή τη στρατηγική. Στην αιτιολόγηση, ξεκίνα αναφέροντας ότι αυτοί οι πελάτες δεν είναι το κύριο κοινό αυτής της στρατηγικής, αλλά εξήγησε πώς μπορούν να αξιοποιηθούν με προσαρμοσμένες ενέργειες. Πρότεινε κανάλια που ταιριάζουν στα χαρακτηριστικά τους ανεξάρτητα από τη στρατηγική.',
};

export interface SegmentFitInfo {
  name: string;
  fit: FitLevel;
  description?: string;
  count?: number;
  revenueShare?: number;
}

export interface CampaignPerformanceData {
  channel: string;
  spent: number;
  roas: number;
  conversions: number;
  ctr: number;
}

export type PromptContext = 'strategy' | 'activation';

/**
 * Triage origin context — αν η στρατηγική προέκυψε από Decision Bucket triage, μεταφέρουμε
 * τη διαγνωστική ρίζα στο prompt ώστε το AI να ευθυγραμμίσει tone/CTA/budget με το πρόβλημα
 * που εντοπίστηκε (π.χ. dead capital → urgency clearance, hot seller → scale-up).
 */
export interface TriagePromptContext {
  bucketLabel: string;
  bucketDescription?: string;
  skuCount: number;
  tiedCapital?: number;
  topSkus?: string[];
}

/**
 * Provenance snapshot — επιγραμματικά από ποιες πηγές προέρχεται το dataset (connector,
 * stock movement, procurement, import). Βοηθά το AI να καλιμπράρει τη βεβαιότητα του
 * rationale (π.χ. αν δεν υπάρχει connector, αποφεύγει υπεσχέσεις real-time ROAS).
 */
export interface ProvenancePromptContext {
  connectorPct: number;
  movementPct: number;
  procurementPct: number;
  importPct: number;
  totalProducts: number;
}

export function buildChannelRecommendationsUserPrompt(params: {
  scenarioName: string;
  scenarioDescription: string;
  segmentName: string;
  segmentDescription: string;
  segmentCount: number;
  revenueShare: number;
  fitLevel?: FitLevel;
  brandName?: string;
  brandType?: 'B2B' | 'B2C';
  topCategories?: string[];
  segmentFitList?: SegmentFitInfo[];
  totalBudget?: number;
  campaignPerformance?: CampaignPerformanceData[];
  context?: PromptContext;
  triage?: TriagePromptContext;
  provenance?: ProvenancePromptContext;
}): string {
  const {
    scenarioName,
    scenarioDescription,
    segmentName,
    segmentDescription,
    segmentCount,
    revenueShare,
    fitLevel = 'good',
    brandName,
    brandType,
    topCategories,
    segmentFitList,
    totalBudget,
    campaignPerformance,
    context = 'strategy',
    triage,
    provenance,
  } = params;

  const triageSection = triage
    ? `\n\nΔΙΑΓΝΩΣΤΙΚΗ ΡΙΖΑ (Decision Bucket):
- Bucket: «${triage.bucketLabel}»${triage.bucketDescription ? ` — ${triage.bucketDescription}` : ''}
- Σκοπευμένα SKUs: ${triage.skuCount}${triage.tiedCapital ? ` | Δεσμευμένα κεφάλαια: €${Math.round(triage.tiedCapital).toLocaleString('el-GR')}` : ''}${triage.topSkus && triage.topSkus.length > 0 ? `\n- Ενδεικτικά SKUs: ${triage.topSkus.slice(0, 5).join(', ')}` : ''}

Η στρατηγική δεν επιλέχθηκε γενικά, αλλά προέκυψε από συγκεκριμένο διαγνωστικό πρόβλημα. Ευθυγράμμισε όλες τις προτάσεις, δηλαδή κανάλια, budget allocation, rationale και actions, με αυτή τη ρίζα. Ενδεικτικά: dead capital → έμφαση σε εκκαθάριση και επαναστόχευση με αυστηρό έλεγχο κόστους. Hot seller → ενίσχυση επένδυσης και διεύρυνση κοινού. Stockout risk → περιορισμός ή παύση πίεσης έως την αναπλήρωση. Ανέφερε ρητά στο rationale ότι η ενέργεια στοχεύει το πρόβλημα «${triage.bucketLabel}».`
    : '';

  const provenanceSection = provenance && provenance.totalProducts > 0
    ? `\n\nΠΗΓΕΣ ΔΕΔΟΜΕΝΩΝ (data provenance, ${provenance.totalProducts} SKUs):
- Real-time orders connector: ${provenance.connectorPct}%
- Stock movement (απόθεμα): ${provenance.movementPct}%
- Procurement (ERP): ${provenance.procurementPct}%
- Import-only (στατικά): ${provenance.importPct}%

${provenance.connectorPct < 30 ? 'ΠΡΟΣΟΧΗ: Χαμηλή κάλυψη real-time orders. Απόφυγε υπεσχέσεις άμεσου ROAS — προτίμησε εκτιμήσεις βασισμένες σε stock κίνηση και ιστορικό. ' : ''}${provenance.procurementPct > 50 ? 'Έχουμε δυνατό procurement signal — μπορείς να αναφέρεις margin/τιμολόγηση με σιγουριά. ' : ''}`
    : '';

  const fitContext = FIT_CONTEXT[fitLevel];

  const brandSection = brandName
    ? `Επιχείρηση: ${brandName}${brandType ? ` (${brandType === 'B2C' ? 'πωλήσεις προς καταναλωτές' : 'πωλήσεις προς επιχειρήσεις'})` : ''}${topCategories && topCategories.length > 0 ? `\nΚύριες κατηγορίες προϊόντων: ${topCategories.slice(0, 5).join(', ')}` : ''}\n\n`
    : '';

  const formatSegmentDetail = (s: SegmentFitInfo) => {
    let detail = s.name;
    if (s.description) detail += ` (${s.description})`;
    if (s.count) detail += `, ${s.count.toLocaleString()} πελάτες`;
    if (s.revenueShare) detail += `, ${s.revenueShare}% εσόδων`;
    return detail;
  };

  const idealSegments = segmentFitList?.filter(s => s.fit === 'ideal') ?? [];
  const goodSegments = segmentFitList?.filter(s => s.fit === 'good') ?? [];
  const segmentMapSection = (idealSegments.length > 0 || goodSegments.length > 0)
    ? `\nΣχετικά segments για αυτή τη στρατηγική:${idealSegments.length > 0 ? `\nΙδανικά segments:\n${idealSegments.map(s => `- ${formatSegmentDetail(s)}`).join('\n')}` : ''}${goodSegments.length > 0 ? `\nΚαλά segments:\n${goodSegments.map(s => `- ${formatSegmentDetail(s)}`).join('\n')}` : ''}\n`
    : '';

  return `${brandSection}Εμπορική στρατηγική: ${scenarioName}
Περιγραφή στρατηγικής: ${scenarioDescription}

Segment πελατών: ${segmentName}
Χαρακτηριστικά segment: ${segmentDescription}
Αριθμός πελατών: ${segmentCount.toLocaleString()}
Μερίδιο εσόδων: ${revenueShare}%

Βαθμός ταιριάσματος segment-στρατηγικής: ${fitLevel === 'ideal' ? 'Ιδανικό' : fitLevel === 'good' ? 'Καλό' : 'Μερικό'}
${fitContext}
${segmentMapSection}${triageSection}${provenanceSection}
Πρότεινε τα κατάλληλα κανάλια μάρκετινγκ (primary, secondary, budget_allocation, rationale) σε JSON.
Η αιτιολόγηση πρέπει να είναι πλήρως στα Ελληνικά.${brandName ? ` Ανέφερε το brand «${brandName}» ονομαστικά μέσα στο rationale, αντί για γενικόλογο "η επιχείρηση" ή "το brand σας".${topCategories && topCategories.length > 0 ? ` Συνέδεσε τις προτάσεις με τα πραγματικά προϊόντα/κατηγορίες (${topCategories.slice(0, 3).join(', ')}).` : ''}` : ''}
Στο "Πελάτες:" section:
1. Πρώτα αναλύεις το ΤΡΕΧΟΝ segment (αυτό που ζητήθηκε) με πλήρη ανάλυση
2. Μετά αφιερώνεις 1 bullet ΓΙΑ ΚΑΘΕ ένα από τα υπόλοιπα ιδανικά και καλά segments. Κάθε bullet πρέπει να εξηγεί ΠΟΙΟΙ είναι αυτοί οι πελάτες και ΓΙΑΤΙ ταιριάζουν σε αυτή τη στρατηγική. ΟΧΙ απλή αναφορά ονόματος.
Π.χ. "...Οι «Champions» αγοράζουν συχνά και ξοδεύουν πολλά.\n• «Loyal Customers»: πιστοί πελάτες με σταθερές αγορές, κατάλληλοι για αναβάθμιση πωλήσεων σε κατηγορίες υψηλότερης αξίας\n• «Promising»: νέοι πελάτες με δυναμική ανάπτυξης, κατάλληλοι για στοχευμένες προσφορές που μπορούν να τους μετατρέψουν σε τακτικούς αγοραστές\n• «At Risk»: ενεργοί πελάτες που απομακρύνονται και χρειάζονται ενέργειες επανενεργοποίησης πριν χαθούν"${context === 'activation' ? `

ΠΛΑΙΣΙΟ: Αυτή η ανάλυση εμφανίζεται στη σελίδα CHANNEL ACTIVATION και τη βλέπουν marketer και agency. Γράψε τεχνικά και πρακτικά:
- Στα "Κανάλια": Για κάθε κανάλι πρότεινε ΣΥΓΚΕΚΡΙΜΕΝΕΣ ΕΝΕΡΓΕΙΕΣ ΥΛΟΠΟΙΗΣΗΣ (τύπο campaign, targeting, ad format, bidding strategy). Πρότεινε ΙΔΕΕΣ ΔΗΜΙΟΥΡΓΙΚΟΥ (creatives, copy angles, hooks, offers). Χρησιμοποίησε marketing terminology (ROAS, CPA, LTV, lookalike audiences, dynamic ads, retargeting windows κλπ.).
- Στο "Αποτέλεσμα": Δώσε εκτιμώμενα KPIs ανά κανάλι (target ROAS, expected CPA range, conversion rate benchmarks). Πρότεινε testing framework (A/B tests, creative rotation).
- Ο τόνος είναι σαν brief που αποστέλλεται από εμπορικό διευθυντή προς agency, με σαφήνεια και επαγγελματική πειθαρχία.` : `

ΠΛΑΙΣΙΟ: Αυτή η ανάλυση εμφανίζεται στη σελίδα COMMERCIAL STRATEGY και τη βλέπει ο ΙΔΙΟΚΤΗΤΗΣ της επιχείρησης.

ΚΑΝΟΝΑΣ ΜΗΚΟΥΣ: Κράτα το rationale σύντομο αλλά ουσιαστικό. Ο επιχειρηματίας θέλει να καταλάβει τι κάνουμε, σε ποιους απευθυνόμαστε, γιατί το επιλέγουμε και τι αναμένουμε, χωρίς περιττό jargon.

ΣΤΥΛ:
- Γράψε σε καθαρά ελληνικά. Εξήγησε τους αγγλικούς marketing όρους σε παρένθεση μόνο όταν είναι απαραίτητο
- Ο τόνος είναι στρατηγικός, ψύχραιμος και κατανοητός, σαν παρουσίαση σε διοικητική σύσκεψη
- Στα "Πελάτες": 2-3 προτάσεις για το κύριο segment. Μετά 1 bullet ανά επιπλέον segment που ταιριάζει
- Στα "Κανάλια": 1 εισαγωγική πρόταση και μετά 1 bullet ανά κανάλι. Κάθε bullet να αποτυπώνει ρόλο, λογική επιλογής και αναμενόμενη συμβολή
- Στο "Αποτέλεσμα": 3-4 bullets με συγκεκριμένα αλλά ρεαλιστικά αναμενόμενα οφέλη, όπως ενίσχυση εσόδων, καλύτερη αξιοποίηση budget ή βελτίωση ποιότητας ζήτησης)`}${totalBudget ? `\n\nΜΗΝΙΑΙΟ BUDGET: €${totalBudget.toLocaleString('el-GR')}\nΛάβε υπόψη αυτό το budget στην κατανομή. Στο "actions" πρότεινε συγκεκριμένες ενέργειες διαχείρισης προϋπολογισμού βάσει στρατηγικής.` : ''}${campaignPerformance && campaignPerformance.length > 0 ? `\n\nΠΡΑΓΜΑΤΙΚΑ ΔΕΔΟΜΕΝΑ ΑΠΟΔΟΣΗΣ ΚΑΜΠΑΝΙΩΝ:\n${campaignPerformance.map(c => `- ${c.channel}: Δαπάνη €${c.spent.toLocaleString('el-GR', { maximumFractionDigits: 0 })}, ROAS ${c.roas.toFixed(1)}x, Conversions ${c.conversions}, CTR ${c.ctr.toFixed(1)}%`).join('\n')}\nΑνάλυσε τα δεδομένα απόδοσης και δώσε εφαρμόσιμες προτάσεις στο "actions" (increase/decrease/push/pause/maintain για κάθε κανάλι).` : ''}`;
}
