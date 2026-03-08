/**
 * Prompt για AI Organic Content Suggestions.
 * Προτείνει οργανικές ενέργειες (content types, channels, headlines) βάσει αποθηκευμένης στρατηγικής.
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
}

export const CONTENT_SUGGESTIONS_SYSTEM_PROMPT = `Είσαι ειδικός content strategist για e-commerce. Απαντάς ΑΠΟΚΛΕΙΣΤΙΚΑ στα Ελληνικά.

Προτείνεις οργανικές ενέργειες περιεχομένου (όχι paid ads) βάσει της ενεργής εμπορικής στρατηγικής.

Απάντα ΜΟΝΟ με valid JSON, χωρίς markdown ή εξήγηση. Format:
{
  "actions": [
    {
      "type": "Τύπος ενέργειας (π.χ. Email, Blog, Social Post, Newsletter)",
      "title": "Σύντομος τίτλος ενέργειας στα Ελληνικά",
      "description": "Περιγραφή 1-2 προτάσεις στα Ελληνικά, σαφής και κατανοητή",
      "channel": "Κανάλι (π.χ. Email, Instagram, Blog, Facebook, LinkedIn)",
      "priority": "high" | "medium" | "low",
      "headline_suggestion": "Παράδειγμα headline στα Ελληνικά"
    }
  ]
}

Κανόνες:
- 4-6 συγκεκριμένες ενέργειες
- Μόνο οργανικά κανάλια (όχι paid ads)
- ΟΛΑ τα κείμενα (title, description, headline_suggestion) ΠΡΕΠΕΙ να είναι 100% στα Ελληνικά. Μην χρησιμοποιείς greeklish ή μείγμα γλωσσών.
- Προτεραιότητα "high" για τις πιο σημαντικές
- headline_suggestion: 1 ρεαλιστικό παράδειγμα ανά ενέργεια, στα Ελληνικά`;

export function buildContentSuggestionsUserPrompt(ctx: StrategyContext): string {
  const w = ctx.weights || {};
  const weightsStr = `Profit: ${w.profit ?? 0}%, Stock: ${w.stock ?? 0}%, Strategic: ${w.strategic ?? 0}%, Revenue: ${w.revenue ?? 0}%, Fit: ${w.fit ?? 0}%`;

  return `Ενεργή στρατηγική: ${ctx.scenarioName}
Βάρη: ${weightsStr}

${ctx.contentTone ? `Tone: ${ctx.contentTone}` : ''}
${ctx.contentTypes?.length ? `Τύποι περιεχομένου: ${ctx.contentTypes.join(', ')}` : ''}
${ctx.channels?.length ? `Καλύτερα κανάλια: ${ctx.channels.join(', ')}` : ''}
${ctx.ctaStyle ? `CTA στυλ: ${ctx.ctaStyle}` : ''}
${ctx.avoid?.length ? `Αποφυγή: ${ctx.avoid.join(', ')}` : ''}
${ctx.sampleHeadlines?.length ? `Παραδείγματα headlines: ${ctx.sampleHeadlines.slice(0, 3).join(' | ')}` : ''}

Δώσε 4-6 οργανικές ενέργειες περιεχομένου (actions array) σε JSON.`;
}
