import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { callGemini, type GeminiChatTurn } from './geminiProxy';
import { buildNiliaSystemPrompt } from '../data/niliaPrompt';
import { getCachedBriefing } from './morningBriefing';

const MODEL_NAME = 'gemini-2.5-pro';
/** Πόσα turns ιστορικού στέλνουμε στο μοντέλο (έλεγχος κόστους + context). */
const MAX_HISTORY_TURNS = 12;
/** Σταθερό session id ανά brand — μία τρέχουσα συνομιλία ανά brand. */
const CURRENT_SESSION = 'current';

export interface NiliaMessage {
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

interface NiliaSessionDoc {
  brandId: string;
  messages: NiliaMessage[];
  updatedAt: Timestamp;
}

function sessionRef(brandId: string) {
  return doc(db, 'brands', brandId, 'nilia_sessions', CURRENT_SESSION);
}

/**
 * Φόρτωση της τρέχουσας συνομιλίας του brand.
 * BRAND ISOLATION: επιστρέφει μηνύματα ΜΟΝΟ αν το doc ανήκει στο ίδιο brandId.
 */
export async function loadNiliaSession(brandId: string): Promise<NiliaMessage[]> {
  if (!brandId) return [];
  try {
    const snap = await getDoc(sessionRef(brandId));
    if (!snap.exists()) return [];
    const data = snap.data() as NiliaSessionDoc;
    if (data.brandId !== brandId) return []; // guard κατά mismatch
    return Array.isArray(data.messages) ? data.messages : [];
  } catch {
    return [];
  }
}

export async function saveNiliaSession(brandId: string, messages: NiliaMessage[]): Promise<void> {
  if (!brandId) return;
  try {
    // Κρατάμε λογικό όριο μεγέθους doc (τελευταία ~60 μηνύματα).
    const trimmed = messages.slice(-60);
    await setDoc(sessionRef(brandId), {
      brandId,
      messages: trimmed,
      updatedAt: Timestamp.now(),
    } satisfies NiliaSessionDoc);
  } catch {
    /* μη κρίσιμο — η συνομιλία συνεχίζει in-memory */
  }
}

export async function clearNiliaSession(brandId: string): Promise<void> {
  if (!brandId) return;
  try {
    await setDoc(sessionRef(brandId), { brandId, messages: [], updatedAt: Timestamp.now() } satisfies NiliaSessionDoc);
  } catch {
    /* ignore */
  }
}

/** Μετατροπή ιστορικού μηνυμάτων σε turns για το Gemini (assistant -> model). */
export function toGeminiHistory(messages: NiliaMessage[]): GeminiChatTurn[] {
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
  const brandRef = brandName ? `το brand ${brandName}` : 'το brand σου';
  const lines: string[] = [];
  lines.push(`Καλημέρα! Είμαι η **Nilia**, η εμπορική σου σύμβουλος για ${brandRef}.`);

  try {
    const brief = await getCachedBriefing(brandId, period ?? 'current_month');
    if (brief?.narrative) {
      lines.push('');
      lines.push(`**Η εικόνα της ημέρας:** ${brief.narrative}`);
      if (Array.isArray(brief.actions) && brief.actions.length > 0) {
        lines.push('');
        lines.push('**Προτεινόμενες ενέργειες:**');
        brief.actions.slice(0, 3).forEach((a) => lines.push(`- ${a}`));
      }
    }
  } catch {
    /* αν δεν υπάρχει brief, συνεχίζουμε με το καλωσόρισμα */
  }

  lines.push('');
  if (openInfoCount > 0) {
    lines.push(
      `Έχεις **${openInfoCount}** ενεργές εμπορικές πληροφορίες που λαμβάνω υπόψη. Υπάρχει κάτι νέο που πρέπει να ξέρω;`
    );
  } else {
    lines.push(
      'Υπάρχει κάποια νέα εμπορική πληροφορία που πρέπει να ξέρω; (π.χ. εξέλιξη στην αγορά, γεγονός, κίνηση προμηθευτή, τάση ή το ένστικτό σου). Μπορώ επίσης να σου εξηγήσω οποιοδήποτε KPI ή ενότητα.'
    );
  }
  return lines.join('\n');
}

/**
 * Παραγωγή απάντησης Nilia (multi-turn).
 * BRAND ISOLATION: το brandId περνά στο prompt (system) και στο logging (server).
 */
export async function generateNiliaReply(params: {
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
    systemPrompt: buildNiliaSystemPrompt(brandName, brandId),
    userPrompt,
    model: MODEL_NAME,
    temperature: 0.4,
    history,
    brandId,
  });

  return text?.trim() || 'Δεν κατάφερα να απαντήσω αυτή τη στιγμή. Δοκίμασε ξανά σε λίγο.';
}
