import { where, orderBy, Timestamp } from 'firebase/firestore';
import { FirestoreService } from './firestore';
import { callGemini } from './geminiProxy';
import { buildAdvisorySystemPrompt } from '../data/aiAdvisoryFramework';
import { parseJsonObject } from '../utils/aiJson';

const COLLECTION = 'commercial_info';
const STRUCTURE_MODEL = 'gemini-2.5-flash';

export type CommercialFactorType =
  | 'event' // αθλητικό/πολιτιστικό γεγονός, λανσάρισμα, σεζόν
  | 'trend' // τάση αγοράς/καταναλωτή
  | 'pricing' // ακρίβεια, κόστη, τιμολόγηση
  | 'competition' // κινήσεις ανταγωνισμού
  | 'instinct' // εμπορικό ένστικτο/εμπειρία
  | 'macro'; // μακροοικονομικά/κοινωνικά

export type CommercialDirection = 'up' | 'down' | 'neutral';
export type CommercialMagnitude = 'low' | 'medium' | 'high';
export type CommercialConfidence = 'low' | 'medium' | 'high';
export type CommercialInfoStatus = 'active' | 'archived' | 'applied';

export interface CommercialInfoStructured {
  /** Σύντομη δομημένη αναδιατύπωση της πληροφορίας. */
  summary: string;
  /** Επηρεαζόμενες κατηγορίες προϊόντων. */
  categories: string[];
  /** Επηρεαζόμενα parent SKU / οικογένειες προϊόντων. */
  parentSkus: string[];
  /** Επηρεαζόμενες επωνυμίες/προμηθευτές (π.χ. Adidas). */
  brands: string[];
  factorType: CommercialFactorType;
  direction: CommercialDirection;
  magnitude: CommercialMagnitude;
  /** Ορίζοντας ισχύος (YYYY-MM-DD) ή null αν άγνωστος. */
  horizonFrom: string | null;
  horizonTo: string | null;
  confidence: CommercialConfidence;
}

export interface CommercialInfo extends CommercialInfoStructured {
  id: string;
  brandId: string;
  rawText: string;
  status: CommercialInfoStatus;
  source: 'owner' | 'nilia';
  createdBy: string | null;
  createdAt?: Timestamp;
}

/** Firestore doc shape (structured nested ώστε να μένει καθαρό το top-level). */
interface CommercialInfoDoc {
  brandId: string;
  rawText: string;
  status: CommercialInfoStatus;
  source: 'owner' | 'nilia';
  createdBy: string | null;
  createdAt: Timestamp;
  structured: CommercialInfoStructured;
}

const VALID_FACTORS: CommercialFactorType[] = ['event', 'trend', 'pricing', 'competition', 'instinct', 'macro'];

function coerceStructured(raw: unknown, fallbackText: string): CommercialInfoStructured {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : [];
  const factor = VALID_FACTORS.includes(o.factorType as CommercialFactorType)
    ? (o.factorType as CommercialFactorType)
    : 'instinct';
  const direction: CommercialDirection =
    o.direction === 'up' || o.direction === 'down' ? o.direction : 'neutral';
  const magnitude: CommercialMagnitude =
    o.magnitude === 'low' || o.magnitude === 'high' ? o.magnitude : 'medium';
  const confidence: CommercialConfidence =
    o.confidence === 'high' || o.confidence === 'medium' ? o.confidence : 'low';
  const iso = (v: unknown): string | null =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  const summary = typeof o.summary === 'string' && o.summary.trim() ? o.summary.trim() : fallbackText.slice(0, 280);
  return {
    summary,
    categories: arr(o.categories),
    parentSkus: arr(o.parentSkus),
    brands: arr(o.brands),
    factorType: factor,
    direction,
    magnitude,
    horizonFrom: iso(o.horizonFrom),
    horizonTo: iso(o.horizonTo),
    confidence,
  };
}

const STRUCTURE_SYSTEM = buildAdvisorySystemPrompt(
  `Λαμβάνεις ελεύθερο κείμενο με εμπορική πληροφορία/ένστικτο του επιχειρηματία (π.χ. αθλητικό γεγονός, τάση, ακρίβεια, κίνηση ανταγωνισμού).
Δούλεψέ το σε δομημένη μορφή ώστε να τροφοδοτήσει το εμπορικό πλάνο. Μην εφευρίσκεις δεδομένα — αν κάτι δεν προκύπτει, άφησέ το κενό/null.`,
  { json: true }
);

/**
 * Δομεί ελεύθερο κείμενο εμπορικής πληροφορίας μέσω Gemini Flash.
 * Επιστρέφει πάντα έγκυρο αντικείμενο (fallback αν αποτύχει το AI).
 */
export async function structureCommercialInfo(
  rawText: string,
  context?: { brandName?: string | null; today?: string; knownCategories?: string[] }
): Promise<CommercialInfoStructured> {
  const text = rawText.trim();
  if (!text) return coerceStructured(null, '');

  const today = context?.today ?? new Date().toISOString().slice(0, 10);
  const catsHint = context?.knownCategories?.length
    ? `Γνωστές κατηγορίες brand (προτίμησέ τες όπου ταιριάζουν): ${context.knownCategories.slice(0, 40).join(', ')}.`
    : '';

  const userPrompt = `Σημερινή ημερομηνία: ${today}.
${context?.brandName ? `Brand: "${context.brandName}".` : ''}
${catsHint}

Κείμενο εμπορικής πληροφορίας:
"""${text}"""

Επέστρεψε JSON με ΑΚΡΙΒΩΣ αυτά τα keys:
{
  "summary": "σύντομη δομημένη αναδιατύπωση (1-2 προτάσεις)",
  "categories": ["κατηγορίες προϊόντων που επηρεάζονται"],
  "parentSkus": ["parent SKU / οικογένειες προϊόντων αν αναφέρονται"],
  "brands": ["επωνυμίες/προμηθευτές π.χ. Adidas"],
  "factorType": "event|trend|pricing|competition|instinct|macro",
  "direction": "up|down|neutral",
  "magnitude": "low|medium|high",
  "horizonFrom": "YYYY-MM-DD ή null",
  "horizonTo": "YYYY-MM-DD ή null",
  "confidence": "low|medium|high"
}`;

  try {
    const out = await callGemini({
      systemPrompt: STRUCTURE_SYSTEM,
      userPrompt,
      model: STRUCTURE_MODEL,
      temperature: 0.1,
      brandId: undefined,
    });
    const parsed = parseJsonObject(out);
    return coerceStructured(parsed, text);
  } catch {
    return coerceStructured(null, text);
  }
}

function genId(brandId: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${brandId}_${Date.now()}_${rand}`;
}

/** Δημιουργία εγγραφής εμπορικής πληροφορίας (brand-scoped). */
export async function createCommercialInfo(input: {
  brandId: string;
  rawText: string;
  structured: CommercialInfoStructured;
  source?: 'owner' | 'nilia';
  createdBy?: string | null;
  status?: CommercialInfoStatus;
}): Promise<string> {
  const id = genId(input.brandId);
  const doc: CommercialInfoDoc = {
    brandId: input.brandId,
    rawText: input.rawText.trim(),
    status: input.status ?? 'active',
    source: input.source ?? 'owner',
    createdBy: input.createdBy ?? null,
    createdAt: Timestamp.now(),
    structured: input.structured,
  };
  await FirestoreService.setDocument(COLLECTION, id, doc);
  return id;
}

function flatten(id: string, doc: CommercialInfoDoc & { structured?: CommercialInfoStructured }): CommercialInfo {
  const s = doc.structured ?? coerceStructured(doc, doc.rawText ?? '');
  return {
    id,
    brandId: doc.brandId,
    rawText: doc.rawText ?? '',
    status: doc.status ?? 'active',
    source: doc.source ?? 'owner',
    createdBy: doc.createdBy ?? null,
    createdAt: doc.createdAt,
    ...s,
  };
}

/** Λίστα εμπορικών πληροφοριών για το brand (νεότερες πρώτα). */
export async function listCommercialInfo(brandId: string): Promise<CommercialInfo[]> {
  if (!brandId) return [];
  const docs = await FirestoreService.getDocuments<{ id: string } & CommercialInfoDoc>(
    COLLECTION,
    [orderBy('createdAt', 'desc')],
    brandId
  );
  return docs.map((d) => flatten(d.id, d));
}

/** Μόνο ενεργές πληροφορίες — αυτές που τροφοδοτούν πλάνο/προβλέψεις. */
export async function listActiveCommercialInfo(brandId: string): Promise<CommercialInfo[]> {
  if (!brandId) return [];
  const docs = await FirestoreService.getDocuments<{ id: string } & CommercialInfoDoc>(
    COLLECTION,
    [where('status', '==', 'active')],
    brandId
  );
  return docs
    .map((d) => flatten(d.id, d))
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
}

export async function updateCommercialInfo(
  id: string,
  patch: Partial<Pick<CommercialInfo, 'status' | 'rawText'>> & { structured?: Partial<CommercialInfoStructured> }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.status) payload.status = patch.status;
  if (typeof patch.rawText === 'string') payload.rawText = patch.rawText.trim();
  if (patch.structured) {
    for (const [k, v] of Object.entries(patch.structured)) {
      payload[`structured.${k}`] = v;
    }
  }
  await FirestoreService.updateDocument(COLLECTION, id, payload);
}

export async function deleteCommercialInfo(id: string): Promise<void> {
  await FirestoreService.deleteDocument(COLLECTION, id);
}

/** Συμπυκνωμένη απόδοση ενεργών πληροφοριών για AI prompts (brand-scoped). */
export function formatCommercialInfoForPrompt(items: CommercialInfo[]): string {
  if (!items.length) return '(Καμία καταχωρημένη εμπορική πληροφορία.)';
  const dirLabel: Record<CommercialDirection, string> = { up: 'άνοδος', down: 'πτώση', neutral: 'ουδέτερο' };
  const magLabel: Record<CommercialMagnitude, string> = { low: 'χαμηλή', medium: 'μέτρια', high: 'υψηλή' };
  return items
    .slice(0, 20)
    .map((i, idx) => {
      const scope = [
        i.brands.length ? `επωνυμίες: ${i.brands.join('/')}` : '',
        i.categories.length ? `κατηγορίες: ${i.categories.join('/')}` : '',
        i.parentSkus.length ? `parent SKU: ${i.parentSkus.join('/')}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const horizon = i.horizonFrom || i.horizonTo ? ` [${i.horizonFrom ?? '…'} → ${i.horizonTo ?? '…'}]` : '';
      return `${idx + 1}. ${i.summary} (${dirLabel[i.direction]}, ένταση ${magLabel[i.magnitude]}, εμπιστοσύνη ${i.confidence})${scope ? ` — ${scope}` : ''}${horizon}`;
    })
    .join('\n');
}
