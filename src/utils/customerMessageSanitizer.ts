/** Sanitizer for AI-generated customer-facing messages: strips jargon, segment names, salutations, then cleans grammar/whitespace.
 * Output is plain commercial copy + CTA with no reference to the customer's type/segment. */

const SEGMENT_NAMES = [
  // multi-word first
  'Loyal Customers',
  'New Customers',
  'Recent Customers',
  'About to Sleep',
  "Can't Lose Them",
  'Cant Lose Them',
  'Need Attention',
  'Potential Loyalists',
  'Big Spenders',
  'High Value',
  'At Risk',
  'At-Risk',
  // single-word
  'Champions',
  'Champion',
  'Loyal',
  'Hibernating',
  'Promising',
  'Lost',
];

/** Pleading/begging phrases removed entirely to keep a confident commercial tone. */
const NEEDY_PHRASES: RegExp[] = [
  /Σας\s+έχουμε\s+χάσει[!.,·]?\s*/gi,
  /Μας\s+λείψατε[!.,·]?\s*/gi,
  /Σας\s+(?:έχουμε\s+)?χάσει\s+και\s+θέλουμε\s+να\s+σας\s+(?:κερδίσουμε|επιστρέψουμε|ξανακερδίσουμε)[!.,·]?\s*/gi,
  /Σας\s+περιμένουμε(?:\s+πίσω)?[!.,·]?\s*/gi,
  /(?:Σας\s+)?θέλουμε\s+(?:πίσω|να\s+σας\s+κερδίσουμε)[!.,·]?\s*/gi,
  /(?:Έχει\s+καιρό|Πάει\s+καιρός)\s+(?:από\s+την\s+τελευταία\s+σας\s+επίσκεψη|που\s+σας\s+είδαμε|που\s+δε\s+σας\s+είδαμε)[!.,·]?\s*/gi,
  /Επιστρέψτε(?!\s+με\s+\d)[!.,·]?\s*/gi, // "Come back!" on its own (not followed by a percentage/offer)
];

const JARGON_MAP: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bdead[\s-]?stock\b/gi, replacement: 'επιλεγμένα προϊόντα σε ειδικές τιμές' },
  { pattern: /νεκρ[όο]ύ?\s+αποθ[έε]μα(?:τος)?/gi, replacement: 'επιλεγμένα προϊόντα σε ειδικές τιμές' },
  { pattern: /\bstock\s+clearance\b/gi, replacement: 'μοναδικές ευκαιρίες' },
  { pattern: /εκκαθάριση\s+αποθήκης/gi, replacement: 'μοναδικές ευκαιρίες' },
  { pattern: /ξεπούλημα\s+αποθήκης/gi, replacement: 'μοναδικές ευκαιρίες' },
  { pattern: /\bliquidation\b/gi, replacement: 'ειδικές προσφορές' },
  { pattern: /\bslow[\s-]?movers?\b/gi, replacement: 'επιλεγμένα προϊόντα' },
  { pattern: /αργοκίνητ[αοη]\s+προϊόντα?/gi, replacement: 'επιλεγμένα προϊόντα' },
  { pattern: /\boverstock\b/gi, replacement: 'επιλεγμένα προϊόντα' },
  { pattern: /πλεόνασμα\s+αποθέματος/gi, replacement: 'επιλεγμένα προϊόντα' },
  { pattern: /\bROAS\b/gi, replacement: 'απόδοση' },
  { pattern: /\bCPA\b/gi, replacement: 'κόστος' },
  { pattern: /\bCTR\b/gi, replacement: 'απόδοση' },
  { pattern: /\bLTV\b/gi, replacement: 'αξία' },
  { pattern: /\bconversion\s+rate\b/gi, replacement: 'απόδοση' },
  { pattern: /\bfunnel\b/gi, replacement: 'πορεία αγοράς' },
  { pattern: /\bremarketing\b/gi, replacement: 'στοχευμένη επικοινωνία' },
  { pattern: /\bretargeting\b/gi, replacement: 'στοχευμένη επικοινωνία' },
  { pattern: /\bbudget\s+allocation\b/gi, replacement: 'επένδυση' },
  { pattern: /\bmargin\b/gi, replacement: 'τιμή' },
  { pattern: /περιθώριο\s+κέρδους/gi, replacement: 'ειδική τιμή' },
  { pattern: /\bcohort\b/gi, replacement: 'ομάδα' },
  { pattern: /\bRFM\b/gi, replacement: '' },
  { pattern: /\bscenario\b/gi, replacement: 'πρόταση' },
  { pattern: /στρατηγικ[ήη]ς?\s+(Stock\s+Clearance|Profit\s+Maximization|Brand\s+Launch|Customer\s+Retention)/gi, replacement: 'ειδική προσφορά' },
  { pattern: /\b(Stock\s+Clearance|Profit\s+Maximization|Brand\s+Launch|Customer\s+Retention)\b/gi, replacement: 'ειδική προσφορά' },
];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Check whether a text contains any forbidden phrase. */
export function containsForbiddenContent(text: string | undefined | null): boolean {
  if (!text) return false;
  // Segment name
  for (const seg of SEGMENT_NAMES) {
    const re = new RegExp(`\\b${escapeRegex(seg)}\\b`, 'i');
    if (re.test(text)) return true;
  }
  // Customer-addressing prefixes (forbidden by design — we want pure commercial copy)
  if (/\b(Αγαπητο[ίύ]|Αγαπημένο[ιυ])\s+(?:μας\s+)?(?:πελάτες|φίλοι|χρήστες)/i.test(text)) return true;
  if (/\bΩς\s+(?:ένας?\s+από\s+τους?\s+)?(?:αγαπημένοι?|αγαπημένους?|αγαπητο[ίύ]ς?|πιστο[ίύ]ς?|εκλεκτο[ίύ]ς?|τακτικο[ίύ]ς?)\s+(?:μας\s+)?(?:πελάτες|πελάτη|φίλοι|φίλε|υποστηρικτές)/i.test(text)) return true;
  // Pleading / begging tone
  for (const re of NEEDY_PHRASES) {
    re.lastIndex = 0;
    if (re.test(text)) return true;
  }
  // Internal jargon
  return JARGON_MAP.some(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

/** Sanitizes a customer-facing message: removes segment names, internal jargon, and salutations/customer-type references. */
export function sanitizeCustomerMessage(text: string | undefined | null): string {
  if (!text) return '';
  let result = text;

  // PASS 1: Jargon -> consumer-friendly
  for (const { pattern, replacement } of JARGON_MAP) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }

  // PASS 2: Strip segment names
  for (const seg of SEGMENT_NAMES) {
    const segEsc = escapeRegex(seg);
    result = result.replace(new RegExp(`«\\s*${segEsc}\\s*»`, 'gi'), '');
    result = result.replace(new RegExp(`\\b${segEsc}\\b`, 'gi'), '');
  }

  // Collapse whitespace so the following patterns work reliably
  result = result.replace(/[ \t]+/g, ' ');

  // PASS 3: remove salutations / customer-type references (no reference to the recipient as a group).
  // "customer"-family words denote a reference to a customer group/type.
  const CUST_NOUN = '(?:πελάτες|πελάτη|πελατών|φίλοι|φίλους|φίλο|φίλε|φίλων|υποστηρικτές|υποστηρικτών|αγοραστές|αγοραστών|χρήστες|χρήστη|χρηστών)';
  // Greek word with optional capital
  const GR_WORD = '[Α-Ωα-ωΆ-Ώά-ώa-zA-Z]+';

  result = result
    // "As [up to 6 words] customer/friends/... [of-the Brand][, .]" -> ""
    .replace(
      new RegExp(`\\bΩς\\s+(?:${GR_WORD}\\s+){0,6}?${CUST_NOUN}(?:\\s+(?:της|του|μας)\\s+${GR_WORD})?[,.!?·]?\\s*`, 'g'),
      ''
    )
    // "As of-the Brand[, .]" -> ""  (residual)
    .replace(new RegExp(`\\bΩς\\s+(?:της|του)\\s+${GR_WORD}[,.!?·]?\\s*`, 'g'), '')
    // Bare "As [, .]" -> ""
    .replace(/\bΩς\s*[,.!?·]?\s*/g, '')
    // "Dear/Beloved [up to 3 words] (customers|friends)?[, .]" -> ""
    .replace(
      new RegExp(`\\b(?:Αγαπητο[ίύ]ς?|Αγαπημένο[ιυυς]ς?)\\s+(?:${GR_WORD}\\s+){0,3}?(?:${CUST_NOUN})?[,.!?·]?\\s*`, 'g'),
      ''
    )
    // residual "Dear ," / "Beloved ."
    .replace(/\b(?:Αγαπητο[ίύ]ς?|Αγαπημένο[ιυυς]ς?)\s*[,.!?·]?\s*/g, '')
    // "offers/discounts/prices/opportunities for the ... of-the Brand[!.?]" -> "offers[!.?]"
    .replace(
      new RegExp(
        `\\b(προσφορές|εκπτώσεις|ειδικές\\s+τιμές|τιμές|ευκαιρίες)\\s+για\\s+(?:τους|τις|τον|την|τα)\\s+(?:${GR_WORD}\\s+){0,5}?(?:της|του|μας)\\s+${GR_WORD}(\\s*[!.?·])`,
        'gi'
      ),
      '$1$2'
    )
    // "offers for the customers/friends/..." -> "offers"
    .replace(
      new RegExp(
        `\\b(προσφορές|εκπτώσεις|ειδικές\\s+τιμές|τιμές|ευκαιρίες)\\s+για\\s+(?:τους|τις|τον|την|τα)\\s+(?:${GR_WORD}\\s+){0,5}?${CUST_NOUN}(?:\\s+(?:της|του|μας)\\s+${GR_WORD})?`,
        'gi'
      ),
      '$1'
    )
    // "for the ... customers/friends/... of-the Brand" (mid-phrase) -> ""
    .replace(
      new RegExp(
        `\\bγια\\s+(?:τους|τις|τον|την|τα)\\s+(?:${GR_WORD}\\s+){0,5}?${CUST_NOUN}(?:\\s+(?:της|του|μας)\\s+${GR_WORD})?`,
        'gi'
      ),
      ''
    )
    // "for the ... of-the Brand" (without "customers", e.g. after segment strip)
    .replace(
      new RegExp(
        `\\bγια\\s+(?:τους|τις|τον|την|τα)\\s+(?:${GR_WORD}\\s+){0,5}?(?:της|του|μας)\\s+${GR_WORD}`,
        'gi'
      ),
      ''
    )
    // "for the [, .]" orphan
    .replace(/\bγια\s+(?:τους|τις|τον|την|τα)\s*(?=[,.!?·])/gi, '')
    // "to the ... of-the Brand" -> ""
    .replace(
      new RegExp(
        `\\bπρος\\s+(?:τους|τις|τον|την|τα)\\s+(?:${GR_WORD}\\s+){0,5}?(?:της|του|μας)\\s+${GR_WORD}`,
        'gi'
      ),
      ''
    )
    // "to the customers" -> ""
    .replace(
      new RegExp(`\\bπρος\\s+(?:τους|τις|τον|την|τα)\\s+(?:${GR_WORD}\\s+){0,3}?${CUST_NOUN}`, 'gi'),
      ''
    );

  // PASS 3.5: Strip pleading/begging phrases
  for (const re of NEEDY_PHRASES) {
    re.lastIndex = 0;
    result = result.replace(re, '');
  }

  // PASS 4: Article fixes after the jargon replacements
  result = result
    .replace(/\b(από|στο|στον|στην|στη|με|σε)\s+(το|τον|την|τη)\s+(επιλεγμένα|μοναδικές|ειδικές)\b/gi, '$1 $3')
    .replace(/\b(του|της|το|τον|την|τη)\s+(επιλεγμένα\s+προϊόντα)\b/gi, '$2');

  // PASS 5: Whitespace & punctuation cleanup
  result = result
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?·])/g, '$1')
    .replace(/([,.!?·])\1+/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/^\s*[,.!?·]\s*/g, '')
    .trim();

  // Capitalize first letter
  if (result.length > 0) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }

  return result;
}
