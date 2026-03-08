/**
 * Prompt για AI Organic Content Suggestions.
 * Προτείνει θεματικές κατευθύνσεις ανά κανάλι + παραδείγματα ενεργειών βάσει στρατηγικής.
 */

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
  topCategories?: string[];
  segmentNames?: string[];
}

export const CONTENT_SUGGESTIONS_SYSTEM_PROMPT = `Είσαι ειδικός content strategist για e-commerce. Απαντάς ΑΠΟΚΛΕΙΣΤΙΚΑ στα Ελληνικά.

Δημιουργείς 2 πράγματα:
1. ΘΕΜΑΤΙΚΕΣ ΚΑΤΕΥΘΥΝΣΕΙΣ: Ανά κανάλι επικοινωνίας (Email, Blog, Social Media, Newsletter κλπ), ποιες θεματικές πρέπει να αναπτύξει η ομάδα marketing, βάσει στρατηγικής, segments πελατών και κατηγοριών προϊόντων.
2. ΠΑΡΑΔΕΙΓΜΑΤΑ ΕΝΕΡΓΕΙΩΝ: Συγκεκριμένες ιδέες περιεχομένου ως εφαρμογή των κατευθύνσεων.

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
- Χρησιμοποίησε σαφή δομή στα κείμενα: σύντομες προτάσεις, bullets όπου βοηθά την ανάγνωση`;

export function buildContentSuggestionsUserPrompt(ctx: StrategyContext): string {
  const w = ctx.weights || {};
  const weightsStr = `Profit: ${w.profit ?? 0}%, Stock: ${w.stock ?? 0}%, Strategic: ${w.strategic ?? 0}%, Revenue: ${w.revenue ?? 0}%, Fit: ${w.fit ?? 0}%`;

  const brandSection = ctx.brandName
    ? `Επιχείρηση: ${ctx.brandName}${ctx.topCategories?.length ? `\nΚατηγορίες προϊόντων: ${ctx.topCategories.join(', ')}` : ''}${ctx.segmentNames?.length ? `\nSegments πελατών: ${ctx.segmentNames.join(', ')}` : ''}\n\n`
    : '';

  const personalizationNote = ctx.brandName
    ? `\nΧρησιμοποίησε το brand name «${ctx.brandName}» στα titles, headlines και brief.${ctx.topCategories?.length ? ` Ανέφερε πραγματικές κατηγορίες (${ctx.topCategories.slice(0, 3).join(', ')}).` : ''}${ctx.segmentNames?.length ? ` Ανέφερε πραγματικά segments (${ctx.segmentNames.slice(0, 4).join(', ')}) στις κατευθύνσεις.` : ''}`
    : '';

  return `${brandSection}Ενεργή στρατηγική: ${ctx.scenarioName}
Βάρη: ${weightsStr}

${ctx.contentTone ? `Tone: ${ctx.contentTone}` : ''}
${ctx.contentTypes?.length ? `Τύποι περιεχομένου: ${ctx.contentTypes.join(', ')}` : ''}
${ctx.channels?.length ? `Καλύτερα κανάλια: ${ctx.channels.join(', ')}` : ''}
${ctx.ctaStyle ? `CTA στυλ: ${ctx.ctaStyle}` : ''}
${ctx.avoid?.length ? `Αποφυγή: ${ctx.avoid.join(', ')}` : ''}
${ctx.sampleHeadlines?.length ? `Παραδείγματα headlines: ${ctx.sampleHeadlines.slice(0, 3).join(' | ')}` : ''}

Δώσε directions (θεματικές κατευθύνσεις ανά κανάλι), actions (παραδείγματα ενεργειών) και brief (κείμενο κατευθύνσεων) σε JSON.${personalizationNote}`;
}
