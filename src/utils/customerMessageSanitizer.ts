/**
 * Defense-in-depth sanitizer για AI-generated customer-facing messages.
 *
 * Φιλοσοφία (per user request): καθαρό εμπορικό μήνυμα, χωρίς καμία αναφορά
 * στον τύπο/ομάδα του πελάτη. Καμία προσφώνηση τύπου «Αγαπητοί πελάτες»,
 * «Ως αγαπημένοι μας πελάτες», «για τους πιστούς μας φίλους» κλπ. Μόνο η
 * εμπορική πρόταση + CTA.
 *
 * Pipeline:
 *  1. JARGON REPLACEMENT — αντικαθιστά internal terms με consumer-friendly
 *  2. SEGMENT NAME STRIPPING — αφαιρεί κάθε αναφορά segment ονόματος
 *  3. CUSTOMER ADDRESSING REMOVAL — αφαιρεί προσφωνήσεις (Ως..., Αγαπητοί..., για τους...)
 *  4. ARTICLE/GRAMMAR CLEANUP
 *  5. WHITESPACE CLEANUP
 */

const SEGMENT_NAMES = [
  // multi-word πρώτα
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

/**
 * Φράσεις που ακούγονται παρακλητικές/ικετευτικές — αφαιρούνται εντελώς.
 * Στόχος: αυτοπεποίθηση και εμπορικός τόνος, όχι «μας λείψατε, γυρίστε σας παρακαλούμε».
 */
const NEEDY_PHRASES: RegExp[] = [
  /Σας\s+έχουμε\s+χάσει[!.,·]?\s*/gi,
  /Μας\s+λείψατε[!.,·]?\s*/gi,
  /Σας\s+(?:έχουμε\s+)?χάσει\s+και\s+θέλουμε\s+να\s+σας\s+(?:κερδίσουμε|επιστρέψουμε|ξανακερδίσουμε)[!.,·]?\s*/gi,
  /Σας\s+περιμένουμε(?:\s+πίσω)?[!.,·]?\s*/gi,
  /(?:Σας\s+)?θέλουμε\s+(?:πίσω|να\s+σας\s+κερδίσουμε)[!.,·]?\s*/gi,
  /(?:Έχει\s+καιρό|Πάει\s+καιρός)\s+(?:από\s+την\s+τελευταία\s+σας\s+επίσκεψη|που\s+σας\s+είδαμε|που\s+δε\s+σας\s+είδαμε)[!.,·]?\s*/gi,
  /Επιστρέψτε(?!\s+με\s+\d)[!.,·]?\s*/gi, // «Επιστρέψτε!» μόνο του (αν δεν συνοδεύεται από ποσοστό/προσφορά)
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

/** Έλεγχος αν ένα κείμενο περιέχει οποιαδήποτε forbidden phrase. */
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
  // Παρακλητικός / ικετευτικός τόνος
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

/**
 * Καθαρίζει customer-facing message:
 *  - segment names
 *  - internal jargon
 *  - προσφωνήσεις/αναφορές τύπου πελάτη («Ως ...», «Αγαπητοί ...», «για τους ... της X»)
 */
export function sanitizeCustomerMessage(text: string | undefined | null): string {
  if (!text) return '';
  let result = text;

  // ── PASS 1: Jargon → consumer-friendly ──
  for (const { pattern, replacement } of JARGON_MAP) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }

  // ── PASS 2: Strip segment names ──
  for (const seg of SEGMENT_NAMES) {
    const segEsc = escapeRegex(seg);
    result = result.replace(new RegExp(`«\\s*${segEsc}\\s*»`, 'gi'), '');
    result = result.replace(new RegExp(`\\b${segEsc}\\b`, 'gi'), '');
  }

  // Συμπτύσσουμε whitespace ώστε να δουλέψουν αξιόπιστα τα επόμενα patterns
  result = result.replace(/[ \t]+/g, ' ');

  // ── PASS 3: ΑΦΑΙΡΕΣΗ ΠΡΟΣΦΩΝΗΣΕΩΝ / ΑΝΑΦΟΡΩΝ ΣΕ ΤΥΠΟ ΠΕΛΑΤΗ ──
  // Στόχος: καθαρό εμπορικό μήνυμα. Καμία αναφορά στον αποδέκτη ως ομάδα.
  // Λέξεις «πελάτης» οικογένειας — αυτές δηλώνουν αναφορά σε ομάδα/τύπο πελάτη.
  const CUST_NOUN = '(?:πελάτες|πελάτη|πελατών|φίλοι|φίλους|φίλο|φίλε|φίλων|υποστηρικτές|υποστηρικτών|αγοραστές|αγοραστών|χρήστες|χρήστη|χρηστών)';
  // Greek word με optional capital
  const GR_WORD = '[Α-Ωα-ωΆ-Ώά-ώa-zA-Z]+';

  result = result
    // «Ως [up to 6 words] πελάτης/φίλοι/... [της/του Brand][, .]» → ""
    .replace(
      new RegExp(`\\bΩς\\s+(?:${GR_WORD}\\s+){0,6}?${CUST_NOUN}(?:\\s+(?:της|του|μας)\\s+${GR_WORD})?[,.!?·]?\\s*`, 'g'),
      ''
    )
    // «Ως της/του Brand[, .]» → ""  (residual)
    .replace(new RegExp(`\\bΩς\\s+(?:της|του)\\s+${GR_WORD}[,.!?·]?\\s*`, 'g'), '')
    // Σκέτο «Ως [, .]» → ""
    .replace(/\bΩς\s*[,.!?·]?\s*/g, '')
    // «Αγαπητοί/Αγαπημένοι [up to 3 words] (πελάτες|φίλοι)?[, .]» → ""
    .replace(
      new RegExp(`\\b(?:Αγαπητο[ίύ]ς?|Αγαπημένο[ιυυς]ς?)\\s+(?:${GR_WORD}\\s+){0,3}?(?:${CUST_NOUN})?[,.!?·]?\\s*`, 'g'),
      ''
    )
    // residual «Αγαπητοί ,» / «Αγαπημένοι .»
    .replace(/\b(?:Αγαπητο[ίύ]ς?|Αγαπημένο[ιυυς]ς?)\s*[,.!?·]?\s*/g, '')
    // «προσφορές/εκπτώσεις/τιμές/ευκαιρίες για τους ... της Brand[!.?]» → «προσφορές[!.?]»
    .replace(
      new RegExp(
        `\\b(προσφορές|εκπτώσεις|ειδικές\\s+τιμές|τιμές|ευκαιρίες)\\s+για\\s+(?:τους|τις|τον|την|τα)\\s+(?:${GR_WORD}\\s+){0,5}?(?:της|του|μας)\\s+${GR_WORD}(\\s*[!.?·])`,
        'gi'
      ),
      '$1$2'
    )
    // «προσφορές για τους πελάτες/φίλους/...» → «προσφορές»
    .replace(
      new RegExp(
        `\\b(προσφορές|εκπτώσεις|ειδικές\\s+τιμές|τιμές|ευκαιρίες)\\s+για\\s+(?:τους|τις|τον|την|τα)\\s+(?:${GR_WORD}\\s+){0,5}?${CUST_NOUN}(?:\\s+(?:της|του|μας)\\s+${GR_WORD})?`,
        'gi'
      ),
      '$1'
    )
    // «για τους ... πελάτες/φίλους/... της Brand» (μέσα σε φράση) → ""
    .replace(
      new RegExp(
        `\\bγια\\s+(?:τους|τις|τον|την|τα)\\s+(?:${GR_WORD}\\s+){0,5}?${CUST_NOUN}(?:\\s+(?:της|του|μας)\\s+${GR_WORD})?`,
        'gi'
      ),
      ''
    )
    // «για τους ... της Brand» (χωρίς το «πελάτες», π.χ. μετά strip segment)
    .replace(
      new RegExp(
        `\\bγια\\s+(?:τους|τις|τον|την|τα)\\s+(?:${GR_WORD}\\s+){0,5}?(?:της|του|μας)\\s+${GR_WORD}`,
        'gi'
      ),
      ''
    )
    // «για τους/τις [, .]» orphan
    .replace(/\bγια\s+(?:τους|τις|τον|την|τα)\s*(?=[,.!?·])/gi, '')
    // «προς τους ... της Brand» → ""
    .replace(
      new RegExp(
        `\\bπρος\\s+(?:τους|τις|τον|την|τα)\\s+(?:${GR_WORD}\\s+){0,5}?(?:της|του|μας)\\s+${GR_WORD}`,
        'gi'
      ),
      ''
    )
    // «προς τους πελάτες» → ""
    .replace(
      new RegExp(`\\bπρος\\s+(?:τους|τις|τον|την|τα)\\s+(?:${GR_WORD}\\s+){0,3}?${CUST_NOUN}`, 'gi'),
      ''
    );

  // ── PASS 3.5: Strip παρακλητικές/ικετευτικές φράσεις ──
  for (const re of NEEDY_PHRASES) {
    re.lastIndex = 0;
    result = result.replace(re, '');
  }

  // ── PASS 4: Article fixes μετά τα jargon replacements ──
  result = result
    .replace(/\b(από|στο|στον|στην|στη|με|σε)\s+(το|τον|την|τη)\s+(επιλεγμένα|μοναδικές|ειδικές)\b/gi, '$1 $3')
    .replace(/\b(του|της|το|τον|την|τη)\s+(επιλεγμένα\s+προϊόντα)\b/gi, '$2');

  // ── PASS 5: Whitespace & punctuation cleanup ──
  result = result
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?·])/g, '$1')
    .replace(/([,.!?·])\1+/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/^\s*[,.!?·]\s*/g, '')
    .trim();

  // Capitalize πρώτο γράμμα
  if (result.length > 0) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }

  return result;
}
