/** AI Organic Content Suggestions prompt: thematic directions per channel
 *  plus example actions based on strategy. */

import { buildAdvisorySystemPrompt } from './aiAdvisoryFramework';

export interface TriageContentContext {
  bucketLabel: string;
  bucketDescription?: string;
  skuCount: number;
  tiedCapital?: number;
  topSkus?: string[];
}

export interface ProvenanceContentContext {
  connectorPct: number;
  movementPct: number;
  procurementPct: number;
  importPct: number;
  totalProducts: number;
}

export interface AudienceContentContext {
  policyLabel: 'e-shop orders' | 'e-shop & others';
  eShopCustomers: number;
  totalCustomers: number;
  otherCustomers: number;
  eShopPenetration: number;
  marketingPolicy: string;
}

export interface StrategyContext {
  scenarioId: string;
  scenarioName: string;
  weights: { profit?: number; stock?: number; strategic?: number; revenue?: number; fit?: number };
  contentTone?: string;
  contentTypes?: string[];
  channels?: string[];
  ctaStyle?: string;
  avoid?: string[];
  sampleHeadlines?: string[];
  brandName?: string;
  brandProfileText?: string;
  topCategories?: string[];
  segmentNames?: string[];
  /** Diagnostic root from Decision Buckets (when the strategy came from bucket triage). */
  triage?: TriageContentContext;
  /** Data source snapshot - helps the AI calibrate the confidence of its copy. */
  provenance?: ProvenanceContentContext;
  /** Customer-base policy from Data Analysis. */
  audience?: AudienceContentContext;
}

const CONTENT_SUGGESTIONS_TASK_PROMPT = `Είσαι ανώτερο στέλεχος content strategy για e-commerce. Απαντάς ΑΠΟΚΛΕΙΣΤΙΚΑ στα Ελληνικά.

Δημιουργείς 2 πράγματα:
1. ΘΕΜΑΤΙΚΕΣ ΚΑΤΕΥΘΥΝΣΕΙΣ: Ανά κανάλι επικοινωνίας (Email, Blog, Social Media, Newsletter κλπ), ποιες θεματικές πρέπει να αναπτύξει η ομάδα marketing, βάσει στρατηγικής, segments πελατών και κατηγοριών προϊόντων.
2. ΠΑΡΑΔΕΙΓΜΑΤΑ ΕΝΕΡΓΕΙΩΝ: Συγκεκριμένες ιδέες περιεχομένου ως εφαρμογή των κατευθύνσεων.

MARKETING ΧΑΡΑΚΤΗΡΑΣ:
- Μην περιορίζεσαι σε στεγνή εμπορική ανάλυση. Μετάφρασε τη στρατηγική σε positioning, audience insight, creative angle, offer framing, content pillar και CTA.
- Κάθε direction πρέπει να απαντά: ποιο κοινό κινητοποιεί, ποια ανάγκη/επιθυμία αγγίζει, ποιο μήνυμα κρατάμε και γιατί το κανάλι είναι κατάλληλο.
- Τα headlines να είναι marketing-ready: καθαρά, πειστικά, εφαρμόσιμα, χωρίς hype ή clickbait.
- Το brief πρέπει να μπορεί να δοθεί σε marketing team ή agency ως δημιουργική και εμπορική κατεύθυνση μαζί.

ΠΡΟΣΩΠΟΠΟΙΗΣΗ: Αν σου δοθεί το όνομα της επιχείρησης και οι κατηγορίες προϊόντων, ΠΡΕΠΕΙ να τα χρησιμοποιήσεις παντού. ΜΗΝ χρησιμοποιείς placeholders όπως [Brand] ή [Κατηγορία].

Απάντα ΜΟΝΟ με valid JSON, χωρίς markdown ή εξήγηση. Format:
{
  "directions": [
    {
      "channel": "Κανάλι (π.χ. Email, Blog/SEO, Social Media, Newsletter, LinkedIn)",
      "theme": "Θεματική κατεύθυνση σε 1 πρόταση",
      "reasoning": "Γιατί αυτή η θεματική ταιριάζει στη στρατηγική και στα segments (1-2 προτάσεις)",
      "targetSegments": ["Segment A", "Segment B"],
      "suggestedCategories": ["Κατηγορία 1", "Κατηγορία 2"]
    }
  ],
  "actions": [
    {
      "type": "Τύπος ενέργειας",
      "title": "Σύντομος τίτλος στα Ελληνικά",
      "description": "Περιγραφή 1-2 προτάσεις",
      "channel": "Κανάλι",
      "priority": "high" | "medium" | "low",
      "headline_suggestion": "Παράδειγμα headline στα Ελληνικά"
    }
  ],
  "brief": "Σύντομο brief (3-5 προτάσεις) για την ομάδα marketing/εξωτερικούς συνεργάτες. Περιλαμβάνει: τη στρατηγική κατεύθυνση, τα κύρια segments-στόχους, τις βασικές θεματικές, τον τόνο επικοινωνίας και τι πρέπει να αποφευχθεί."
}

Κανόνες:
- directions: 3-5 κατευθύνσεις, μία ανά κανάλι
- actions: 4-6 συγκεκριμένα παραδείγματα (εφαρμογή των directions)
- brief: ένα copyable κείμενο κατευθύνσεων για αποστολή σε marketing team ή agency
- Μόνο οργανικά κανάλια (όχι paid ads)
- ΟΛΑ τα κείμενα 100% στα Ελληνικά
- Χρήση πραγματικού brand name και κατηγοριών σε headlines και titles
- ΑΠΑΓΟΡΕΥΕΤΑΙ η χρήση em-dash (—). Χρησιμοποίησε τελεία ή κόμμα αντί για παύλες.
- Χρησιμοποίησε σαφή δομή στα κείμενα: σύντομες προτάσεις, bullets όπου βοηθά την ανάγνωση
- Ο τόνος πρέπει να είναι τεχνοκρατικός, ώριμος και φυσικός. Απόφυγε εντυπωσιασμούς, ευκολίες, υπερβολές, συνθηματολογία και διαφημιστικό ύφος
- Μην χρησιμοποιείς emojis, θαυμαστικά, γλώσσα υπερβολής ή γενικόλογες υποσχέσεις
- Το brief πρέπει να διαβάζεται σαν σαφής εμπορική κατεύθυνση προς έμπειρη ομάδα marketing ή agency, όχι σαν διαφημιστικό concept note`;

export const CONTENT_SUGGESTIONS_SYSTEM_PROMPT = buildAdvisorySystemPrompt(
  CONTENT_SUGGESTIONS_TASK_PROMPT,
  { json: true }
);

export function buildContentSuggestionsUserPrompt(ctx: StrategyContext): string {
  const w = ctx.weights || {};
  const weightsStr = `Κερδοφορία: ${w.profit ?? 0}%, Απόθεμα: ${w.stock ?? 0}%, Στρατηγική προτεραιότητα: ${w.strategic ?? 0}%, Έσοδα: ${w.revenue ?? 0}%, Συνάφεια πελάτη: ${w.fit ?? 0}%`;

  const brandSection = ctx.brandName
    ? `Brand (επωνυμία): "${ctx.brandName}"
ΚΑΝΟΝΑΣ: Αναφέρου στο brand ΠΑΝΤΑ ως "το brand ${ctx.brandName}" ή "για το brand ${ctx.brandName}" — ΠΟΤΕ με άρθρο γένους (ο/η) πριν από το brand name.${ctx.topCategories?.length ? `\nΚατηγορίες προϊόντων: ${ctx.topCategories.join(', ')}` : ''}${ctx.segmentNames?.length ? `\nΤμήματα πελατών: ${ctx.segmentNames.join(', ')}` : ''}\n\n`
    : '';

  const personalizationNote = ctx.brandName
    ? `\nΧρησιμοποίησε το brand name «${ctx.brandName}» στα titles, headlines και brief — ΠΑΝΤΑ ως "το brand ${ctx.brandName}" (ουδέτερο), ποτέ με άρθρο γένους.${ctx.topCategories?.length ? ` Ανέφερε πραγματικές κατηγορίες (${ctx.topCategories.slice(0, 3).join(', ')}).` : ''}${ctx.segmentNames?.length ? ` Ανέφερε πραγματικά segments (${ctx.segmentNames.slice(0, 4).join(', ')}) στις κατευθύνσεις.` : ''}`
    : '';

  const brandProfileSection = ctx.brandProfileText?.trim()
    ? `\nBRAND PROFILE CONTEXT:
${ctx.brandProfileText.trim()}

Κανόνας Brand Profile: καθοδηγεί tone of voice, positioning, archetype, ICPs, CTA style, campaign angle και offer framing. Δεν υπερισχύει των πραγματικών data, stock constraints, segments ή εμπορικής στρατηγικής.\n`
    : '';

  return `${brandSection}Ενεργή στρατηγική: ${ctx.scenarioName}
Βάρη: ${weightsStr}

${ctx.contentTone ? `Τόνος επικοινωνίας: ${ctx.contentTone}` : ''}
${ctx.contentTypes?.length ? `Τύποι περιεχομένου: ${ctx.contentTypes.join(', ')}` : ''}
${ctx.channels?.length ? `Κατάλληλα κανάλια: ${ctx.channels.join(', ')}` : ''}
${ctx.ctaStyle ? `Ύφος προτροπής: ${ctx.ctaStyle}` : ''}
${ctx.avoid?.length ? `Αποφυγή: ${ctx.avoid.join(', ')}` : ''}
${ctx.sampleHeadlines?.length ? `Ενδεικτικοί τίτλοι: ${ctx.sampleHeadlines.slice(0, 3).join(' | ')}` : ''}${brandProfileSection}
${ctx.triage ? `\nΔΙΑΓΝΩΣΤΙΚΗ ΡΙΖΑ (Decision Bucket):
- Bucket: «${ctx.triage.bucketLabel}»${ctx.triage.bucketDescription ? ` — ${ctx.triage.bucketDescription}` : ''}
- Σκοπευμένα SKUs: ${ctx.triage.skuCount}${ctx.triage.tiedCapital ? ` | Δεσμευμένα κεφάλαια: €${Math.round(ctx.triage.tiedCapital).toLocaleString('el-GR')}` : ''}${ctx.triage.topSkus?.length ? `\n- Ενδεικτικά SKUs: ${ctx.triage.topSkus.slice(0, 5).join(', ')}` : ''}

Όλα τα directions, actions, brief και headlines πρέπει να αντανακλούν αυτή τη ρίζα. Ενδεικτικά: dead capital → έμφαση σε εκκαθάριση και περιορισμένη διαθεσιμότητα. Hot seller → κοινωνική απόδειξη και ειδοποιήσεις αναπλήρωσης. Stockout risk → λίστα αναμονής ή ειδοποίηση διαθεσιμότητας. Ανέφερε ρητά στο brief ότι η στρατηγική στοχεύει το πρόβλημα «${ctx.triage.bucketLabel}».
` : ''}${ctx.provenance && ctx.provenance.totalProducts > 0 ? `\nΠΗΓΕΣ ΔΕΔΟΜΕΝΩΝ: connector ${ctx.provenance.connectorPct}% · stock movement ${ctx.provenance.movementPct}% · procurement ${ctx.provenance.procurementPct}% · import ${ctx.provenance.importPct}%${ctx.provenance.connectorPct < 30 ? '\nΧαμηλή κάλυψη real-time orders — απόφυγε υπεσχέσεις άμεσων αποτελεσμάτων στο copy.' : ''}\n` : ''}${ctx.audience && ctx.audience.totalCustomers > 0 ? `\nΠΟΛΙΤΙΚΗ ΠΕΛΑΤΟΛΟΓΙΟΥ:
- Επιλογή χρήστη: ${ctx.audience.policyLabel}
- Σύνολο πελατών στη βάση ανάλυσης: ${ctx.audience.totalCustomers.toLocaleString('el-GR')}
- Αναγνωρίσιμοι e-shop αγοραστές: ${ctx.audience.eShopCustomers.toLocaleString('el-GR')} (${ctx.audience.eShopPenetration}%)
- Others / ERP-only ή offline-influenced κοινό: ${ctx.audience.otherCustomers.toLocaleString('el-GR')}
${ctx.audience.marketingPolicy}
Αν η πολιτική είναι "e-shop & others", το content brief πρέπει να δίνει omnichannel κατεύθυνση: το digital περιεχόμενο μπορεί να επηρεάζει πελάτες που τελικά αγοράζουν σε φυσικό κατάστημα.\n` : ''}
Δώσε directions (θεματικές κατευθύνσεις ανά κανάλι), actions (παραδείγματα ενεργειών) και brief (κείμενο κατευθύνσεων) σε JSON.
Το κείμενο πρέπει να είναι κατάλληλο για έμπειρο εμπορικό ή marketing κοινό: σαφές, επαγγελματικό, φυσικό και χωρίς εντυπωσιασμούς.${personalizationNote}`;
}
