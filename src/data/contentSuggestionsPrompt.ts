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

export const CONTENT_SUGGESTIONS_SYSTEM_PROMPT = `Είσαι ειδικός content strategist για e-commerce. Προτείνεις οργανικές ενέργειες περιεχομένου (όχι paid ads) βάσει της ενεργής εμπορικής στρατηγικής.

Απάντα ΜΟΝΟ με valid JSON, χωρίς markdown ή εξήγηση. Format:
{
  "actions": [
    {
      "type": "string (π.χ. Email, Blog, Social Post, Newsletter)",
      "title": "Σύντομος τίτλος ενέργειας",
      "description": "1-2 προτάσεις τι να κάνουν",
      "channel": "Κανάλι (π.χ. Email nurture, Instagram, Blog)",
      "priority": "high" | "medium" | "low",
      "headline_suggestion": "Παράδειγμα headline στα Ελληνικά"
    }
  ]
}

Κανόνες:
- 4-6 συγκεκριμένες ενέργειες
- Μόνο οργανικά κανάλια (όχι paid ads)
- Τίτλοι και descriptions στα Ελληνικά
- Προτεραιότητα high για τις πιο σημαντικές
- headline_suggestion: 1 παράδειγμα ανά ενέργεια`;

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
