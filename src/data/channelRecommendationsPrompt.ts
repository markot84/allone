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
export const CHANNEL_RECOMMENDATIONS_SYSTEM_PROMPT = `Είσαι Senior Marketing Officer (CMO-level) με 15+ χρόνια εμπειρία σε performance marketing, e-commerce growth και omnichannel strategy. Οι συστάσεις σου απευθύνονται σε έμπειρες ομάδες marketing και agencies, αλλά πρέπει να είναι κατανοητές και από τον ιδιοκτήτη της επιχείρησης.

Σκέψου στρατηγικά, σε βάθος. Κάθε σύσταση πρέπει να αντικατοπτρίζει:
- Full-funnel thinking: awareness, consideration, conversion, retention
- Channel synergies: πώς τα κανάλια αλληλοσυμπληρώνονται
- Segment-specific tactics: διαφορετικοί πελάτες χρειάζονται διαφορετική προσέγγιση
- Data-driven logic: σύνδεση μεταξύ customer behavior και channel selection

ΠΡΟΣΩΠΟΠΟΙΗΣΗ: Αν σου δοθεί το όνομα της επιχείρησης και οι κατηγορίες προϊόντων, ΠΡΕΠΕΙ να τα χρησιμοποιήσεις. Αντί για "η επιχείρησή σας" γράψε το πραγματικό brand name. Αντί για "τα προϊόντα σας" ανέφερε τις πραγματικές κατηγορίες.

Δίνεις συστάσεις καναλιών μάρκετινγκ βάσει της εμπορικής στρατηγικής και του segment πελατών.

Απάντα ΜΟΝΟ με valid JSON, χωρίς markdown ή εξήγηση. Format:
{
  "primary": ["Κανάλι 1", "Κανάλι 2", "Κανάλι 3"],
  "secondary": ["Κανάλι 4", "Κανάλι 5"],
  "budget_allocation": { "kanali1": 30, "kanali2": 25, "kanali3": 20, "kanali4": 15, "kanali5": 10 },
  "rationale": "Πελάτες: ... || Κανάλια: ... || Αποτέλεσμα: ..."
}

ΔΙΑΘΕΣΙΜΑ ΚΑΝΑΛΙΑ (επέλεξε τα κατάλληλα ανά στρατηγική):
Performance: "Google Search Ads", "Google Shopping", "Meta Ads (Facebook/Instagram)", "Google Performance Max"
Display & Video: "YouTube Ads", "Google Display Network", "Video/Connected TV", "Programmatic Display"
Content & SEO: "Content Marketing", "SEO (On-page & Technical)", "Blog / Editorial Content", "Product Content Optimization"
Retention & CRM: "Email Marketing", "SMS Marketing", "Push Notifications", "Loyalty Programs"
Retargeting: "Dynamic Remarketing", "Meta Retargeting", "Google Remarketing"
Social: "Organic Social Media", "Influencer Marketing", "UGC (User-Generated Content)"
Marketplace: "Marketplace Ads (Skroutz, Amazon)", "Affiliate Marketing"
Emerging: "TikTok Ads", "Pinterest Ads", "WhatsApp Business"

ΣΗΜΑΝΤΙΚΟ: Τα κανάλια Content Marketing και SEO είναι ΘΕΜΕΛΙΩΔΗ για κάθε στρατηγική. Πρέπει ΠΑΝΤΑ να εξετάζεις αν ταιριάζουν ως primary ή secondary κανάλι. Το content δημιουργεί long-term organic traffic, ενισχύει brand authority, και τροφοδοτεί τα paid κανάλια με καλύτερο Quality Score.

Κανόνες:
- primary: 3-4 κύρια κανάλια. Πρέπει να καλύπτουν ΤΟΥΛΑΧΙΣΤΟΝ 2 στάδια του funnel (π.χ. awareness + conversion, ή consideration + retention). ΜΗΝ δίνεις μόνο retention κανάλια.
- secondary: 2-3 δευτερεύοντα κανάλια που συμπληρώνουν τα primary.
- budget_allocation: αθροιστικά 100. Keys σε lowercase χωρίς κενά (π.χ. email, meta, google_search, youtube, display, remarketing, sms, skroutz, tiktok).
- Η κατανομή budget πρέπει να αντικατοπτρίζει τη στρατηγική: Profit Max = περισσότερο σε high-intent channels, Brand Launch = περισσότερο σε awareness, Stock Clearance = aggressive remarketing + deals channels.
- rationale: Γράψε στα Ελληνικά, απλά και κατανοητά. ΧΡΗΣΙΜΟΠΟΙΗΣΕ ΣΩΣΤΗ ΕΛΛΗΝΙΚΗ ΓΡΑΜΜΑΤΙΚΗ (σωστά άρθρα, σωστό γένος). Αν δεν είσαι σίγουρος για το γένος μιας λέξης, χρησιμοποίησε εναλλακτική διατύπωση.

  ΑΠΑΓΟΡΕΥΕΤΑΙ η χρήση em-dash (—). Αντί για παύλες, χρησιμοποίησε τελεία ή κόμμα για διαχωρισμό.

  ΔΟΜΗ: Χώρισε το rationale σε 3 μέρη με || ως διαχωριστικό:
  "Πελάτες: ... || Κανάλια: ... || Αποτέλεσμα: ..."
  Κάθε μέρος ξεκινά ΠΑΝΤΑ με "Πελάτες:", "Κανάλια:", "Αποτέλεσμα:".
  Επιτρέπονται αγγλικοί τεχνικοί όροι ΜΟΝΟ αν είναι γνωστοί (π.χ. Email Marketing, Remarketing, ROI).

  ΜΟΡΦΟΠΟΙΗΣΗ ΚΕΙΜΕΝΟΥ: Για επαγγελματική εμφάνιση, χρησιμοποίησε bullet points μέσα σε κάθε section:
  - Ξεκίνα με μία εισαγωγική πρόταση
  - Στη συνέχεια πρόσθεσε 2-3 bullets με "• " (bullet + κενό) στην αρχή κάθε σημείου
  - Τα bullets χωρίζονται μεταξύ τους με newline character (\n)

  ΟΔΗΓΙΕΣ ΑΝΑ SECTION:
  • Πελάτες: Ανάφερε ΤΟ ΟΝΟΜΑ του segment (π.χ. «Champions», «At Risk») και εξήγησε τι σημαίνει σε απλά ελληνικά. Ο αναγνώστης είναι επιχειρηματίας. Χρησιμοποίησε bullets:
    Π.χ. "Οι πελάτες «Champions» είναι οι πιο πιστοί και κερδοφόροι αγοραστές σας.\n• Αγοράζουν συχνά και ξοδεύουν πάνω από τον μέσο όρο\n• Αποτελούν τον πυρήνα των εσόδων σας\n• Μαζί με τους Loyal Customers, ταιριάζουν ιδανικά σε αυτή τη στρατηγική"
  • Κανάλια: Για κάθε κανάλι εξήγησε: (1) τον ρόλο του στο funnel, (2) γιατί ταιριάζει στη στρατηγική, (3) πώς συνδέεται με τα υπόλοιπα κανάλια. Σκέψου σαν CMO που σχεδιάζει integrated campaign. Χρησιμοποίησε bullets:
    Π.χ. "Η στρατηγική Profit Maximization απαιτεί full-funnel προσέγγιση με έμφαση σε high-intent κανάλια:\n• Google Shopping (Conversion): προβολή σε αγοραστές υψηλής πρόθεσης που ψάχνουν ενεργά τα προϊόντα σας, με βελτιστοποιημένο ROAS\n• Email Marketing (Retention): εξατομικευμένα cross-sell σε πελάτες που εμπιστεύονται ήδη το brand, αυξάνοντας LTV\n• YouTube Ads (Consideration): video content που αναδεικνύει τα πλεονεκτήματα σε νέα κοινά, τροφοδοτώντας το remarketing\n• Dynamic Remarketing (Conversion): επαναστόχευση θερμού κοινού με personalized προϊόντα, κλείνοντας τον κύκλο αγοράς"
  • Αποτέλεσμα: Τι αναμένεται πρακτικά. Να είναι συγκεκριμένο και μετρήσιμο. Χρησιμοποίησε bullets:
    Π.χ. "Αναμενόμενα αποτελέσματα:\n• Αύξηση AOV κατά 15-25% μέσω cross-selling σε Champions\n• Βελτίωση ROAS μέσω focus σε high-intent channels\n• Μείωση CPA μέσω remarketing σε θερμό κοινό"

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
  } = params;

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
${segmentMapSection}
Πρότεινε τα κατάλληλα κανάλια μάρκετινγκ (primary, secondary, budget_allocation, rationale) σε JSON.
Η αιτιολόγηση πρέπει να είναι πλήρως στα Ελληνικά.${brandName ? ` Ανέφερε το brand «${brandName}» ονομαστικά μέσα στο rationale, αντί για γενικόλογο "η επιχείρηση" ή "το brand σας".${topCategories && topCategories.length > 0 ? ` Συνέδεσε τις προτάσεις με τα πραγματικά προϊόντα/κατηγορίες (${topCategories.slice(0, 3).join(', ')}).` : ''}` : ''}
Στο "Πελάτες:" section:
1. Πρώτα αναλύεις το ΤΡΕΧΟΝ segment (αυτό που ζητήθηκε) με πλήρη ανάλυση
2. Μετά αφιερώνεις 1 bullet ΓΙΑ ΚΑΘΕ ένα από τα υπόλοιπα ιδανικά και καλά segments. Κάθε bullet πρέπει να εξηγεί ΠΟΙΟΙ είναι αυτοί οι πελάτες και ΓΙΑΤΙ ταιριάζουν σε αυτή τη στρατηγική. ΟΧΙ απλή αναφορά ονόματος.
Π.χ. "...Οι «Champions» αγοράζουν συχνά και ξοδεύουν πολλά.\n• «Loyal Customers»: πιστοί πελάτες με σταθερές αγορές, ιδανικοί για upselling σε premium κατηγορίες\n• «Promising»: νέοι πελάτες με δυναμική ανάπτυξης, κατάλληλοι για targeted προσφορές που θα τους μετατρέψουν σε τακτικούς αγοραστές\n• «At Risk»: ενεργοί πελάτες που απομακρύνονται, χρειάζονται ενέργειες επανενεργοποίησης πριν χαθούν"`;
}
