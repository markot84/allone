/** AI Market Brief: structured JSON for Market Exploration (estimates, not live market data). */

import { buildAdvisorySystemPrompt } from './aiAdvisoryFramework';

const MARKET_BRIEF_TASK_PROMPT = `Είσαι senior B2B/B2C market strategist και pricing analyst. Παράγεις AI Market Brief για είσοδο σε νέα γεωγραφική αγορά.

ΚΑΝΟΝΕΣ:
- Απάντα ΜΟΝΟ με valid JSON, χωρίς markdown ή εξήγηση εκτός JSON.
- Όλα τα κείμενα στα Ελληνικά (εκτός αν τα ονόματα εταιρειών είναι διεθνή).
- ΑΠΑΓΟΡΕΥΕΤΑΙ em-dash (—). Χρησιμοποίησε τελεία ή κόμμα.
- Μην ισχυρίζεσαι πρόσβαση σε proprietary datasets. Χρησιμοποίησε εκτιμήσεις με ρεαλισμό και σαφή uncertainty language μέσα στα strings.
- Τα νούμερα τιμών στο price_benchmarking είναι ενδεικτικά ranges (όχι live quotes). Αν δεν μπορείς να είσαι συγκεκριμένος, βάλε null στα indicative_low / indicative_high και εξήγησε στο notes.
- competitors: 4-8 εγγραφές, ρεαλιστικά ονόματα ή «τύποι ανταγωνιστών» αν δεν γνωρίζεις ακριβή local players.
- product_fit: 5-10 εγγραφές, συνδεδμένες με τις κατηγορίες/SKU context που σου δίνονται.
- Πρόσθεσε πεδίο disclaimer στα Ελληνικά που εξηγεί ότι το brief είναι AI synthesis και χρειάζεται validation από field research.

JSON schema (υποχρεωτικά keys):
{
  "country_name": "string",
  "country_code": "string (ISO2 upper)",
  "vertical_focus": "string ή κενό",
  "executive_summary": "string 3-5 προτάσεις",
  "market_snapshot": {
    "size_signal": "string",
    "growth_outlook": "string",
    "maturity": "string",
    "key_channels": ["string"]
  },
  "demand_drivers": ["string"],
  "competitive_landscape": [
    { "name": "string", "position": "string", "notes": "string" }
  ],
  "product_fit": [
    { "label": "string (κατηγορία ή SKU)", "fit": "strong|moderate|weak", "rationale": "string" }
  ],
  "price_benchmarking": [
    { "category": "string", "indicative_low": number|null, "indicative_high": number|null, "currency": "EUR", "notes": "string" }
  ],
  "route_to_market": { "recommended": "string", "rationale": "string" },
  "risks_barriers": ["string"],
  "next_validation_steps": ["string"],
  "disclaimer": "string"
}`;

export const MARKET_BRIEF_SYSTEM_PROMPT = buildAdvisorySystemPrompt(
  MARKET_BRIEF_TASK_PROMPT,
  { json: true }
);

export interface MarketBriefPromptContext {
  brandName: string;
  brandType: 'B2B' | 'B2C';
  countryName: string;
  countryCode: string;
  verticalFocus?: string;
  activeStrategyName?: string;
  topCategories: string[];
  sampleSkus: string[];
  productsCount: number;
  suppliersCount: number;
}

export function buildMarketBriefUserPrompt(ctx: MarketBriefPromptContext): string {
  const cats = ctx.topCategories.length ? ctx.topCategories.join(', ') : 'δεν δόθηκαν κατηγορίες';
  const skus = ctx.sampleSkus.length ? ctx.sampleSkus.join(', ') : 'δεν δόθηκαν SKU';
  const strat = ctx.activeStrategyName ? `Ενεργή εμπορική στρατηγική (context): ${ctx.activeStrategyName}.` : 'Δεν υπάρχει ενεργή στρατηγική στο σύστημα.';

  return `Brand: "${ctx.brandName}" (${ctx.brandType === 'B2C' ? 'B2C' : 'B2B'}) — ΚΑΝΟΝΑΣ: Αναφέρου ως "το brand ${ctx.brandName}" — ποτέ με άρθρο γένους (ο/η) πριν από το brand name.
Στοχευμένη χώρα: ${ctx.countryName} (${ctx.countryCode})
${ctx.verticalFocus ? `Εστίαση κλάδου/vertical (από χρήστη): ${ctx.verticalFocus}` : 'Χωρίς επιπλέον vertical override από χρήστη.'}

Δεδομένα από το Performance+ (context μόνο, όχι πλήρες catalog):
- Πλήθος ενεργών προϊόντων/SKU στο workspace: ${ctx.productsCount}
- Κύριες κατηγορίες (από δείγμα): ${cats}
- Δείγμα SKU: ${skus}
- Πλήθος suppliers στο workspace: ${ctx.suppliersCount}
${strat}

Ζητούμενο: παράγε το JSON σύμφωνα με το schema. Προσαρμόσου στη χώρα και στο brand. Σύνδεσε product_fit και price_benchmarking με τις κατηγορίες που δόθηκαν.`;
}
