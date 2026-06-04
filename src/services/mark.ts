import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { callGemini, type GeminiChatTurn } from './geminiProxy';
import { buildMarkSystemPrompt } from '../data/markPrompt';
import { getCachedBriefing } from './morningBriefing';

const MODEL_NAME = 'gemini-2.5-pro';
/** Πόσα turns ιστορικού στέλνουμε στο μοντέλο (έλεγχος κόστους + context). */
const MAX_HISTORY_TURNS = 12;
/** Σταθερό session id ανά brand — μία τρέχουσα συνομιλία ανά brand. */
const CURRENT_SESSION = 'current';
/** Νέα collection sessions. Παλιό όνομα (nilia_sessions) διαβάζεται για migration. */
const SESSIONS_COLLECTION = 'mark_sessions';
const LEGACY_SESSIONS_COLLECTION = 'nilia_sessions';

/**
 * Η ελληνική φωνητική αναγνώριση γράφει συχνά λάθος το όνομα «Mark» — π.χ. «μάρκτη», «μάρκο»,
 * «μάρκη», «μάρκος». Κανονικοποιούμε ΜΟΝΟ ξεκάθαρες παραλλαγές του wake word σε «Mark»,
 * χωρίς να πειράζουμε υπαρκτές λέξεις όπως «μάρκα» ή «μάρκετινγκ» (λόγω του lookahead σε όριο λέξης).
 */
const MARK_WAKE_ALIASES = [
  'μάρκτη', 'μαρκτη', 'μάρκος', 'μάρκου', 'μάρκο', 'μάρκη', 'μάρκε', 'μάρκι', 'μαρκι',
  'μαρκς', 'μάρκ', 'μαρκ', 'marko', 'marc', 'mark',
];

/**
 * Συντηρητικός διορθωτής συχνών φωνητικών λαθών σε εμπορικούς όρους (ελληνικό STT).
 * Περιλαμβάνει ΜΟΝΟ μεταγραφές που σχεδόν αποκλείεται να είναι κανονική λέξη σε
 * εμπορικό ερώτημα (π.χ. «ιησού»→«e-shop»). Πιο διφορούμενα (π.χ. «ξύλο»→«τζίρο»)
 * τα αναλαμβάνει το μοντέλο μέσω prompt, για να μη χαλάμε υπαρκτές λέξεις.
 * Το matching γίνεται σε ολόκληρη λέξη (whole-word).
 */
const DOMAIN_PHONETIC_FIXES: Array<{ aliases: string[]; canonical: string }> = [
  { aliases: ['ιησού', 'ιησου', 'εσοπ', 'έσοπ', 'ισοπ', 'ίσοπ'], canonical: 'e-shop' },
  { aliases: ['ρόας', 'ρωας', 'ρόουας'], canonical: 'ROAS' },
];

function normalizeMarkDomainTerms(text: string): string {
  let out = text;
  for (const { aliases, canonical } of DOMAIN_PHONETIC_FIXES) {
    const re = new RegExp(`(^|\\s)(?:${aliases.join('|')})(?=\\s|[.,!?;:·]|$)`, 'giu');
    out = out.replace(re, (_m, pre: string) => `${pre}${canonical}`);
  }
  return out;
}

export function normalizeMarkTranscript(text: string): string {
  if (!text) return text;
  const aliasGroup = MARK_WAKE_ALIASES.join('|');
  // (αρχή/κενό) + προαιρετικός χαιρετισμός + alias, μόνο όταν ακολουθεί όριο λέξης/σημείο στίξης/τέλος.
  const re = new RegExp(
    `(^|\\s)(γει[άα]\\s+σου|γεια|έλα|οκ|hey)?\\s*(?:${aliasGroup})(?=\\s|[.,!?;:·]|$)`,
    'iu'
  );
  const withWakeWord = text.replace(re, (_m, pre: string, greet?: string) => `${pre}${greet ? `${greet} ` : ''}Mark`);
  return normalizeMarkDomainTerms(withWakeWord);
}

export interface MarkMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  relatedArticles?: string[];
  webSources?: Array<{ title: string; url: string; snippet: string }>;
  /** Αν αυτό το μήνυμα οδήγησε σε καταχώριση εμπορικής πληροφορίας. */
  savedInfoId?: string;
  /** Proactive καλωσόρισμα (δεν στέλνεται ως context turn). */
  proactive?: boolean;
}

interface MarkSessionDoc {
  brandId: string;
  messages: MarkMessage[];
  updatedAt: Timestamp;
}

function sessionRef(brandId: string) {
  return doc(db, 'brands', brandId, SESSIONS_COLLECTION, CURRENT_SESSION);
}

function legacySessionRef(brandId: string) {
  return doc(db, 'brands', brandId, LEGACY_SESSIONS_COLLECTION, CURRENT_SESSION);
}

/**
 * Φόρτωση της τρέχουσας συνομιλίας του brand.
 * BRAND ISOLATION: επιστρέφει μηνύματα ΜΟΝΟ αν το doc ανήκει στο ίδιο brandId.
 * MIGRATION: αν δεν υπάρχει νέο session, διαβάζει το παλιό (nilia_sessions) και το μεταφέρει.
 */
export async function loadMarkSession(brandId: string): Promise<MarkMessage[]> {
  if (!brandId) return [];
  try {
    const snap = await getDoc(sessionRef(brandId));
    if (snap.exists()) {
      const data = snap.data() as MarkSessionDoc;
      if (data.brandId !== brandId) return []; // guard κατά mismatch
      return Array.isArray(data.messages) ? data.messages : [];
    }
    // Migration από παλιό collection (μία φορά).
    const legacy = await getDoc(legacySessionRef(brandId));
    if (legacy.exists()) {
      const data = legacy.data() as MarkSessionDoc;
      if (data.brandId === brandId && Array.isArray(data.messages)) {
        await saveMarkSession(brandId, data.messages);
        return data.messages;
      }
    }
    return [];
  } catch {
    return [];
  }
}

export async function saveMarkSession(brandId: string, messages: MarkMessage[]): Promise<void> {
  if (!brandId) return;
  try {
    // Κρατάμε λογικό όριο μεγέθους doc (τελευταία ~60 μηνύματα).
    const trimmed = messages.slice(-60);
    await setDoc(sessionRef(brandId), {
      brandId,
      messages: trimmed,
      updatedAt: Timestamp.now(),
    } satisfies MarkSessionDoc);
  } catch {
    /* μη κρίσιμο — η συνομιλία συνεχίζει in-memory */
  }
}

export async function clearMarkSession(brandId: string): Promise<void> {
  if (!brandId) return;
  try {
    await setDoc(sessionRef(brandId), { brandId, messages: [], updatedAt: Timestamp.now() } satisfies MarkSessionDoc);
  } catch {
    /* ignore */
  }
}

/** Μετατροπή ιστορικού μηνυμάτων σε turns για το Gemini (assistant -> model). */
export function toGeminiHistory(messages: MarkMessage[]): GeminiChatTurn[] {
  return messages
    .filter((m) => !m.proactive && m.content.trim().length > 0)
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', text: m.content }));
}

/**
 * Proactive καθημερινό καλωσόρισμα: διαβάζει το cached brief του brand και προτρέπει για
 * νέες εμπορικές πληροφορίες. Deterministic (χωρίς AI call) για μηδενικό κόστος.
 */
export async function buildProactiveGreeting(params: {
  brandId: string;
  brandName: string | null;
  openInfoCount: number;
  period?: string;
}): Promise<string> {
  const { brandId, brandName, openInfoCount, period } = params;
  const lines: string[] = [];
  lines.push(
    brandName
      ? `**Mark** — εμπορικός σύμβουλος για το **${brandName}**.`
      : '**Mark** — εμπορικός σύμβουλος. Επίλεξε brand για προτάσεις.'
  );

  try {
    const brief = await getCachedBriefing(brandId, period ?? 'current_month');
    if (brief?.narrative) {
      lines.push('');
      lines.push(`**Εικόνα της ημέρας:** ${brief.narrative}`);
      if (Array.isArray(brief.actions) && brief.actions.length > 0) {
        lines.push('');
        lines.push('**Προτεινόμενες ενέργειες:**');
        brief.actions.slice(0, 3).forEach((a) => lines.push(`- ${a}`));
      }
    }
  } catch {
    /* αν δεν υπάρχει brief, συνεχίζουμε με το μήνυμα έναρξης */
  }

  lines.push('');
  if (openInfoCount > 0) {
    lines.push(
      `**${openInfoCount}** ενεργές εμπορικές πληροφορίες λαμβάνονται υπόψη. Υπάρχει κάποια νέα;`
    );
  } else {
    lines.push(
      'Καταχώρισε νέα εμπορική πληροφορία (εξέλιξη αγοράς, γεγονός, κίνηση προμηθευτή, τάση) ή ζήτησε εξήγηση για οποιοδήποτε KPI ή ενότητα.'
    );
  }
  return lines.join('\n');
}

/**
 * Παραγωγή απάντησης Mark (multi-turn).
 * BRAND ISOLATION: το brandId περνά στο prompt (system) και στο logging (server).
 */
export async function generateMarkReply(params: {
  brandId: string;
  brandName: string | null;
  userQuery: string;
  tenantSnapshotText: string;
  commercialInfoText: string;
  history: GeminiChatTurn[];
  knowledgeExcerpts?: string;
  webContext?: string;
}): Promise<string> {
  const {
    brandId,
    brandName,
    userQuery,
    tenantSnapshotText,
    commercialInfoText,
    history,
    knowledgeExcerpts,
    webContext,
  } = params;

  const userPrompt = `--- ΣΥΝΟΨΗ ΛΟΓΑΡΙΑΣΜΟΥ (ΜΟΝΟ για το ενεργό brand) ---
${tenantSnapshotText}

--- ΚΑΤΑΧΩΡΗΜΕΝΕΣ ΕΜΠΟΡΙΚΕΣ ΠΛΗΡΟΦΟΡΙΕΣ (ένστικτο/γνώση επιχειρηματία) ---
${commercialInfoText}
${knowledgeExcerpts ? `\n--- ΑΠΟΣΠΑΣΜΑΤΑ KNOWLEDGE LIBRARY ---\n${knowledgeExcerpts}\n` : ''}${webContext ? `\n--- ΠΛΗΡΟΦΟΡΙΕΣ ΑΠΟ ΔΙΑΔΙΚΤΥΑΚΗ ΑΝΑΖΗΤΗΣΗ ---\n${webContext}\n` : ''}
--- ΜΗΝΥΜΑ ΧΡΗΣΤΗ ---
${userQuery}

Απάντησε σύντομα στα Ελληνικά. Αν ο χρήστης μοιράζεται νέα εμπορική πληροφορία, κάνε 1-2 διευκρινιστικές ερωτήσεις και πρότεινε αν θες να την καταχωρήσουμε.`;

  const text = await callGemini({
    systemPrompt: buildMarkSystemPrompt(brandName, brandId),
    userPrompt,
    model: MODEL_NAME,
    temperature: 0.7,
    history,
    brandId,
  });

  return text?.trim() || 'Δεν κατάφερα να απαντήσω αυτή τη στιγμή. Δοκίμασε ξανά σε λίγο.';
}
