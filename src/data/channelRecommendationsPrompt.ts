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
export const CHANNEL_RECOMMENDATIONS_SYSTEM_PROMPT = `Είσαι σύμβουλος στρατηγικής μάρκετινγκ για e-commerce. Απευθύνεσαι σε ιδιοκτήτες επιχειρήσεων και marketing managers — ΟΧΙ μόνο σε ειδικούς.

ΠΡΟΣΩΠΟΠΟΙΗΣΗ: Αν σου δοθεί το όνομα της επιχείρησης και οι κατηγορίες προϊόντων, ΠΡΕΠΕΙ να τα χρησιμοποιήσεις στο rationale. Αντί για "η επιχείρησή σας" γράψε το πραγματικό brand name. Αντί για "τα προϊόντα σας" ανέφερε τις πραγματικές κατηγορίες. Αυτό κάνει τις συστάσεις μοναδικές και χρήσιμες.

Δίνεις συστάσεις καναλιών μάρκετινγκ βάσει της εμπορικής στρατηγικής και του segment πελατών.

Απάντα ΜΟΝΟ με valid JSON, χωρίς markdown ή εξήγηση. Format:
{
  "primary": ["Κανάλι 1", "Κανάλι 2"],
  "secondary": ["Κανάλι 3"],
  "budget_allocation": { "kanali1": 40, "kanali2": 35, "kanali3": 25 },
  "rationale": "Πελάτες: ... || Κανάλια: ... || Αποτέλεσμα: ..."
}

Κανόνες:
- primary: 2-3 κύρια κανάλια. Χρησιμοποίησε τα αναγνωρισμένα ονόματα (π.χ. "Email Marketing", "Meta Ads", "Google Shopping", "SMS", "Remarketing") — δεν μεταφράζονται.
- secondary: 1-2 δευτερεύοντα κανάλια.
- budget_allocation: αθροιστικά 100. Keys σε lowercase χωρίς κενά (π.χ. email, meta, google, sms, remarketing).
- rationale: Γράψε στα Ελληνικά, απλά και κατανοητά. ΧΡΗΣΙΜΟΠΟΙΗΣΕ ΣΩΣΤΗ ΕΛΛΗΝΙΚΗ ΓΡΑΜΜΑΤΙΚΗ — σωστά άρθρα, σωστό γένος (π.χ. "αυτό το segment" ΟΧΙ "αυτός ο segment", "αυτή η ομάδα" ΟΧΙ "αυτός η ομάδα"). Αν δεν είσαι σίγουρος για το γένος μιας λέξης, χρησιμοποίησε εναλλακτική διατύπωση.
  ΔΟΜΗ: Χώρισε το rationale σε 3 μέρη με || ως διαχωριστικό:
  "Πελάτες: ... || Κανάλια: ... || Αποτέλεσμα: ..."
  Κάθε μέρος ξεκινά ΠΑΝΤΑ με "Πελάτες:", "Κανάλια:", "Αποτέλεσμα:".
  Επιτρέπονται αγγλικοί τεχνικοί όροι ΜΟΝΟ αν είναι γνωστοί (π.χ. Email Marketing, Remarketing, ROI).

  ΟΔΗΓΙΕΣ ΑΝΑ SECTION:
  • Πελάτες: Ανάφερε ΤΟ ΟΝΟΜΑ του segment (π.χ. "Champions", "At Risk") και εξήγησε τι σημαίνει αυτό σε απλά ελληνικά. Ο αναγνώστης είναι επιχειρηματίας, όχι marketer — βοήθησέ τον να καταλάβει ποιοι ακριβώς είναι αυτοί οι πελάτες χωρίς να τον κατακλύσεις με ορολογία. Π.χ. "Οι πελάτες «Champions» είναι οι πιο πιστοί και κερδοφόροι — αγοράζουν συχνά, ξοδεύουν πάνω από τον μέσο όρο και αποτελούν τον πυρήνα των εσόδων σας."
  • Κανάλια: Εξήγησε ΓΙΑΤΙ κάθε προτεινόμενο κανάλι εξυπηρετεί ΑΥΤΗ ΤΗ ΣΤΡΑΤΗΓΙΚΗ για ΑΥΤΟΥΣ ΤΟΥΣ ΠΕΛΑΤΕΣ. Μην απαριθμείς απλά τα κανάλια — δώσε τη λογική σύνδεση. Π.χ. "Η στρατηγική Profit Maximization εστιάζει στη μεγιστοποίηση κέρδους, γι' αυτό προτείνουμε Email Marketing για εξατομικευμένες προσφορές σε πελάτες που ήδη εμπιστεύονται το brand σας, και Remarketing για να ενθαρρύνετε επαναλαμβανόμενες αγορές υψηλής αξίας."
  • Αποτέλεσμα: Τι αναμένεται πρακτικά — π.χ. αύξηση μέσης αξίας παραγγελίας, μείωση κόστους απόκτησης, κλπ.

  ΣΩΣΤΟ: "Πελάτες: Οι πελάτες «Champions» είναι οι πιο αφοσιωμένοι αγοραστές σας — αγοράζουν τακτικά, ξοδεύουν πολλά και συνεισφέρουν το μεγαλύτερο μέρος των εσόδων σας. || Κανάλια: Εφόσον η στρατηγική σας στοχεύει στη μεγιστοποίηση κέρδους, το Email Marketing σας επιτρέπει να στείλετε αποκλειστικές προσφορές σε αυτούς που ήδη εμπιστεύονται το brand σας, ενώ το Remarketing τους υπενθυμίζει προϊόντα που τους ενδιαφέρουν για να αυξηθούν οι επαναλαμβανόμενες αγορές. || Αποτέλεσμα: Αναμένεται αύξηση της μέσης αξίας παραγγελίας και ενίσχυση της μακροχρόνιας αφοσίωσης, μεγιστοποιώντας το ROI."
  ΛΑΘΟΣ: "Αυτοί οι πελάτες είναι οι πιο πιστοί και κερδοφόροι" (δεν αναφέρει το segment)
  ΛΑΘΟΣ: "Το Email Marketing και το SMS επιτρέπουν άμεση επικοινωνία" (δεν εξηγεί γιατί σε σχέση με τη στρατηγική)
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

  const idealSegments = segmentFitList?.filter(s => s.fit === 'ideal').map(s => s.name) ?? [];
  const goodSegments = segmentFitList?.filter(s => s.fit === 'good').map(s => s.name) ?? [];
  const segmentMapSection = (idealSegments.length > 0 || goodSegments.length > 0)
    ? `\nΣχετικά segments για αυτή τη στρατηγική:${idealSegments.length > 0 ? `\n- Ιδανικά: ${idealSegments.join(', ')}` : ''}${goodSegments.length > 0 ? `\n- Καλά: ${goodSegments.join(', ')}` : ''}\n`
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
Στο "Πελάτες:" section, αφού περιγράψεις το τρέχον segment, ανέφερε σύντομα ποια άλλα segments ταιριάζουν επίσης σε αυτή τη στρατηγική (ιδανικά & καλά), ώστε ο επιχειρηματίας να έχει ολοκληρωμένη εικόνα. Π.χ. "...Μαζί με τους Champions, ιδανικά ταιριάζουν επίσης οι Loyal Customers, ενώ καλή εφαρμογή έχει και στους Promising."`;
}
