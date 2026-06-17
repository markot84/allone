import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { callGemini, type GeminiChatTurn } from './geminiProxy';
import { buildMarkSystemPrompt } from '../data/markPrompt';
import { getCachedBriefing } from './morningBriefing';

const MODEL_NAME = 'gemini-2.5-pro';
/** How many history turns we send to the model (cost + context control). */
const MAX_HISTORY_TURNS = 12;
/** Fixed session id per brand — one current conversation per brand. */
const CURRENT_SESSION = 'current';
/** New sessions collection. Old name (nilia_sessions) is read for migration. */
const SESSIONS_COLLECTION = 'mark_sessions';
const LEGACY_SESSIONS_COLLECTION = 'nilia_sessions';

/** Normalize Greek-STT mis-transcriptions of "Mark" (e.g. «μάρκτη», «μάρκο») to "Mark",
 *  leaving real words like «μάρκα»/«μάρκετινγκ» via the word-boundary lookahead. */
const MARK_WAKE_ALIASES = [
  'μάρκτη', 'μαρκτη', 'μάρκος', 'μάρκου', 'μάρκο', 'μάρκη', 'μάρκε', 'μάρκι', 'μαρκι',
  'μαρκς', 'μάρκ', 'μαρκ', 'marko', 'marc', 'mark',
];

/** Whole-word corrector for Greek-STT phonetic errors in commercial terms; only entries
 *  unlikely to be real words (e.g. «ιησού»→«e-shop»). Ambiguous cases left to the model. */
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
  // (start/space) + optional greeting + alias, only when followed by word boundary/punctuation/end.
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
  /** Whether this message led to a commercial info entry. */
  savedInfoId?: string;
  /** Free text that can be saved as commercial info via a chat CTA. */
  pendingInfoText?: string;
  /** Proactive greeting (not sent as a context turn). */
  proactive?: boolean;
}

interface MarkSessionDoc {
  brandId: string;
  messages: MarkMessage[];
  updatedAt: Timestamp;
}

function localSessionKey(brandId: string) {
  return `mark_session_${brandId}`;
}

function readLocalSession(brandId: string): MarkMessage[] {
  if (typeof window === 'undefined' || !brandId) return [];
  try {
    const raw = window.localStorage.getItem(localSessionKey(brandId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { brandId?: string; messages?: MarkMessage[] };
    if (parsed.brandId !== brandId || !Array.isArray(parsed.messages)) return [];
    return parsed.messages;
  } catch {
    return [];
  }
}

function writeLocalSession(brandId: string, messages: MarkMessage[]) {
  if (typeof window === 'undefined' || !brandId) return;
  try {
    window.localStorage.setItem(
      localSessionKey(brandId),
      JSON.stringify({ brandId, messages: messages.slice(-60), updatedAt: Date.now() })
    );
  } catch {
    /* local fallback is best-effort */
  }
}

function clearLocalSession(brandId: string) {
  if (typeof window === 'undefined' || !brandId) return;
  try {
    window.localStorage.removeItem(localSessionKey(brandId));
  } catch {
    /* ignore */
  }
}

function sessionRef(brandId: string) {
  return doc(db, 'brands', brandId, SESSIONS_COLLECTION, CURRENT_SESSION);
}

function legacySessionRef(brandId: string) {
  return doc(db, 'brands', brandId, LEGACY_SESSIONS_COLLECTION, CURRENT_SESSION);
}

/** Load the brand's current conversation. Returns messages ONLY if the doc's brandId matches;
 *  if no new session exists, migrates from the old nilia_sessions. */
export async function loadMarkSession(brandId: string): Promise<MarkMessage[]> {
  if (!brandId) return [];
  try {
    const snap = await getDoc(sessionRef(brandId));
    if (snap.exists()) {
      const data = snap.data() as MarkSessionDoc;
      if (data.brandId !== brandId) return []; // guard against mismatch
      const messages = Array.isArray(data.messages) ? data.messages : [];
      if (messages.length > 0) writeLocalSession(brandId, messages);
      return messages;
    }
    // Migration from old collection (one-time).
    const legacy = await getDoc(legacySessionRef(brandId));
    if (legacy.exists()) {
      const data = legacy.data() as MarkSessionDoc;
      if (data.brandId === brandId && Array.isArray(data.messages)) {
        await saveMarkSession(brandId, data.messages);
        return data.messages;
      }
    }
    return readLocalSession(brandId);
  } catch {
    return readLocalSession(brandId);
  }
}

export async function saveMarkSession(brandId: string, messages: MarkMessage[]): Promise<void> {
  if (!brandId) return;
  const trimmed = messages.slice(-60);
  writeLocalSession(brandId, trimmed);
  try {
    // Keep a sensible doc size limit (last ~60 messages).
    await setDoc(sessionRef(brandId), {
      brandId,
      messages: trimmed,
      updatedAt: Timestamp.now(),
    } satisfies MarkSessionDoc);
  } catch {
    /* non-critical — the conversation continues in-memory */
  }
}

export async function clearMarkSession(brandId: string): Promise<void> {
  if (!brandId) return;
  clearLocalSession(brandId);
  try {
    await setDoc(sessionRef(brandId), { brandId, messages: [], updatedAt: Timestamp.now() } satisfies MarkSessionDoc);
  } catch {
    /* ignore */
  }
}

/** Convert message history into turns for Gemini (assistant -> model). */
export function toGeminiHistory(messages: MarkMessage[]): GeminiChatTurn[] {
  return messages
    .filter((m) => !m.proactive && m.content.trim().length > 0)
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', text: m.content }));
}

/** Proactive daily greeting: reads the brand's cached brief and prompts for new
 *  commercial info. Deterministic (no AI call) for zero cost. */
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
    /* if no brief exists, continue with the start message */
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

/** Generate a Mark reply (multi-turn). brandId is passed to the prompt (system) and logging. */
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
