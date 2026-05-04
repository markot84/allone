import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { callGemini } from './geminiProxy';
import { classifyStockHealth, getProductTod } from '../utils/productUtils';
import { calculateCampaignMetrics } from '../utils/roiUtils';
import { formatCurrency, formatNumber } from '../utils/format';
import type { Product, Campaign, RFMSegment, AutomationAlert } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface BriefingData {
  revenue: {
    totalOrganic: number;
    totalCampaignRevenue: number;
    storeRevenue: number;
    /** Όταν true, το «Σύνολο Εσόδων» του dashboard = τζίρος παραγγελιών (storeRevenue), ακόμη κι αν είναι 0 — όχι blend organic+ads. */
    ecommerceSourceActive: boolean;
    trueRoas: number;
    revenueGap: number;
    orderCount: number;
    aov: number;
    totalSpend: number;
    roas: number;
    campaignCount: number;
  };
  ga4: {
    sessions: number;
    users: number;
    newUsers: number;
    bounceRate: number;
    conversions: number;
    weeklyChange: { sessions: number | null; users: number | null; conversions: number | null } | null;
  } | null;
  inventory: {
    totalProducts: number;
    deadStock: number;
    lowStock: number;
    excessStock: number;
    deadStockValue: number;
    lowStockTopNames: string[];
  };
  segments: {
    total: number;
    totalCustomers: number;
    atRiskPct: number;
    championsPct: number;
    topSegment: { name: string; pct: number } | null;
  };
  campaigns: {
    topPerformer: { name: string; roas: number } | null;
    worstPerformer: { name: string; roas: number; spend: number } | null;
  };
  alerts: {
    count: number;
    critical: number;
    topAlerts: string[];
  };
  brandName: string;
}

export interface MetricsSnapshot {
  totalRevenue: number;
  totalSpend: number;
  roas: number;
  deadStock: number;
  lowStock: number;
  criticalAlerts: number;
  campaignCount: number;
  atRiskPct: number;
}

export type BriefingUrgency = 'normal' | 'updated';

export interface BriefingResult {
  narrative: string;
  actions: string[];
  generatedAt: string;
  dataHash: string;
  urgency: BriefingUrgency;
  updateReason?: string;
}

export interface CachedBriefing extends BriefingResult {
  _cachedAt: number;
  _genCount: number;
  _snapshot: MetricsSnapshot;
}

// ── Data Collector ───────────────────────────────────────────────────────────

export function collectBriefingData(params: {
  products: Product[];
  campaigns: Campaign[];
  segments: RFMSegment[];
  /** Organic $ για την ίδια περίοδο με τα campaigns / e-shop στο snapshot (π.χ. dashboard period). */
  totalOrganicRevenue: number;
  ga4: {
    totals: { sessions: number; users: number; newUsers: number; bounceRate: number; conversions: number };
    weeklyChange: { sessions: number | null; users: number | null; conversions: number | null } | null;
    hasData: boolean;
  };
  alerts: AutomationAlert[];
  brandName: string;
  supplierTodMap?: Map<string, number>;
  ecommerce?: {
    hasData: boolean;
    totalRevenue: number;
    orderCount: number;
    aov: number;
    connectedPlatforms: string[];
    topPlatform?: string;
  };
}): BriefingData {
  const { products, campaigns, segments, totalOrganicRevenue, ga4, alerts, brandName, supplierTodMap, ecommerce } = params;

  const classify = (p: Product) => classifyStockHealth(p, getProductTod(p, supplierTodMap));
  const deadStock = products.filter(p => classify(p) === 'dead');
  const lowStock = products.filter(p => classify(p) === 'low');
  const excessStock = products.filter(p => classify(p) === 'excess');
  const deadStockValue = deadStock.reduce((sum, p) => sum + (p.price || 0) * (p.stock_level || 0), 0);

  const lowStockTopNames = lowStock
    .sort((a, b) => (b.revenue_period || 0) - (a.revenue_period || 0))
    .slice(0, 5)
    .map(p => p.name);

  const metrics = calculateCampaignMetrics(campaigns);
  const ecommerceSourceActive = Boolean(ecommerce?.hasData);
  const storeRevenue = ecommerceSourceActive ? (ecommerce!.totalRevenue || 0) : 0;
  const trueRoas = metrics.totalSpend > 0 ? storeRevenue / metrics.totalSpend : 0;
  const revenueGap = storeRevenue - (totalOrganicRevenue + metrics.totalRevenue);

  const atRisk = segments.find(s => s.id === 'at_risk' || s.name.toLowerCase().includes('at risk'));
  const champions = segments.find(s => s.id === 'champions' || s.name.toLowerCase().includes('champion'));
  const topSegment = segments.length > 0
    ? [...segments].sort((a, b) => (b.percentage || 0) - (a.percentage || 0))[0]
    : null;

  const sorted = [...campaigns].filter(c => (c.amount_spent || 0) > 0);
  const byRoas = sorted.sort((a, b) => (b.roas || 0) - (a.roas || 0));
  const topPerformer = byRoas.length > 0 ? { name: byRoas[0].name, roas: byRoas[0].roas || 0 } : null;
  const worstPerformer = byRoas.length > 1
    ? { name: byRoas[byRoas.length - 1].name, roas: byRoas[byRoas.length - 1].roas || 0, spend: byRoas[byRoas.length - 1].amount_spent || 0 }
    : null;

  const activeAlerts = alerts.filter(a => a.status === 'new' || a.status === 'acknowledged');
  const criticalAlerts = activeAlerts.filter(a => a.severity === 'critical');

  return {
    revenue: {
      totalOrganic: totalOrganicRevenue,
      totalCampaignRevenue: metrics.totalRevenue,
      storeRevenue,
      ecommerceSourceActive,
      trueRoas,
      revenueGap,
      orderCount: ecommerce?.orderCount || 0,
      aov: ecommerce?.aov || 0,
      totalSpend: metrics.totalSpend,
      roas: metrics.roas,
      campaignCount: campaigns.length,
    },
    ga4: ga4.hasData ? {
      sessions: ga4.totals.sessions,
      users: ga4.totals.users,
      newUsers: ga4.totals.newUsers,
      bounceRate: ga4.totals.bounceRate,
      conversions: ga4.totals.conversions,
      weeklyChange: ga4.weeklyChange,
    } : null,
    inventory: {
      totalProducts: products.length,
      deadStock: deadStock.length,
      lowStock: lowStock.length,
      excessStock: excessStock.length,
      deadStockValue,
      lowStockTopNames,
    },
    segments: {
      total: segments.length,
      totalCustomers: segments.reduce((s, seg) => s + (seg.count || 0), 0),
      atRiskPct: atRisk?.percentage || 0,
      championsPct: champions?.percentage || 0,
      topSegment: topSegment ? { name: topSegment.name, pct: topSegment.percentage } : null,
    },
    campaigns: { topPerformer, worstPerformer },
    alerts: {
      count: activeAlerts.length,
      critical: criticalAlerts.length,
      topAlerts: activeAlerts.slice(0, 3).map(a => a.title),
    },
    brandName,
  };
}

// ── Metrics Snapshot ─────────────────────────────────────────────────────────

function extractSnapshot(data: BriefingData): MetricsSnapshot {
  const headlineRevenue = data.revenue.ecommerceSourceActive
    ? data.revenue.storeRevenue
    : data.revenue.storeRevenue > 0
      ? data.revenue.storeRevenue
      : data.revenue.totalOrganic + data.revenue.totalCampaignRevenue;
  return {
    totalRevenue: headlineRevenue,
    totalSpend: data.revenue.totalSpend,
    roas: data.revenue.roas,
    deadStock: data.inventory.deadStock,
    lowStock: data.inventory.lowStock,
    criticalAlerts: data.alerts.critical,
    campaignCount: data.revenue.campaignCount,
    atRiskPct: data.segments.atRiskPct,
  };
}

// ── Significant Change Detection ─────────────────────────────────────────────

const THRESHOLDS = {
  revenueChangePct: 0.20,    // revenue moved ±20%
  roasDropPct: 0.30,         // ROAS dropped 30%+
  newCriticalAlerts: 1,      // any new critical alert
  deadStockJump: 15,         // 15+ new dead stock items
  atRiskJumpPp: 5,           // At Risk segment grew 5pp+
};

export interface ChangeSignal {
  significant: boolean;
  reason: string;
}

export function detectSignificantChange(
  current: BriefingData,
  cachedSnapshot: MetricsSnapshot,
): ChangeSignal {
  const now = extractSnapshot(current);

  if (cachedSnapshot.totalRevenue === 0 && now.totalRevenue > 0) {
    return { significant: true, reason: 'Εμφανίστηκαν έσοδα περιόδου μετά από κενή κατάσταση' };
  }
  if (cachedSnapshot.totalRevenue > 0 && now.totalRevenue === 0) {
    return { significant: true, reason: 'Μηδενισμός εσόδων περιόδου — έλεγξε sync ή φόρτωση δεδομένων' };
  }

  if (cachedSnapshot.totalRevenue > 0) {
    const revDelta = (now.totalRevenue - cachedSnapshot.totalRevenue) / cachedSnapshot.totalRevenue;
    if (Math.abs(revDelta) >= THRESHOLDS.revenueChangePct) {
      const dir = revDelta > 0 ? 'αύξηση' : 'μείωση';
      return { significant: true, reason: `Σημαντική ${dir} εσόδων (${(revDelta * 100).toFixed(0)}%)` };
    }
  }

  if (cachedSnapshot.roas > 0 && now.roas > 0) {
    const roasDrop = (cachedSnapshot.roas - now.roas) / cachedSnapshot.roas;
    if (roasDrop >= THRESHOLDS.roasDropPct) {
      return { significant: true, reason: `ROAS πτώση ${now.roas.toFixed(1)}x (ήταν ${cachedSnapshot.roas.toFixed(1)}x)` };
    }
  }

  const newCritical = now.criticalAlerts - cachedSnapshot.criticalAlerts;
  if (newCritical >= THRESHOLDS.newCriticalAlerts) {
    return { significant: true, reason: `${newCritical} νέες κρίσιμες ειδοποιήσεις` };
  }

  const deadDelta = now.deadStock - cachedSnapshot.deadStock;
  if (deadDelta >= THRESHOLDS.deadStockJump) {
    return { significant: true, reason: `+${deadDelta} νέα προϊόντα σε αδράνεια` };
  }

  const atRiskDelta = now.atRiskPct - cachedSnapshot.atRiskPct;
  if (atRiskDelta >= THRESHOLDS.atRiskJumpPp) {
    return { significant: true, reason: `Το segment At Risk αυξήθηκε κατά ${atRiskDelta.toFixed(1)} μ.μ.` };
  }

  return { significant: false, reason: '' };
}

// ── Prompt Builder ───────────────────────────────────────────────────────────

function buildBriefingPrompt(data: BriefingData, periodLabel: string, updateContext?: string): string {
  const sections: string[] = [];
  const fallbackBlendedRevenue = data.revenue.totalOrganic + data.revenue.totalCampaignRevenue;
  const ecActive = data.revenue.ecommerceSourceActive;
  const headlineRevenue = ecActive
    ? data.revenue.storeRevenue
    : data.revenue.storeRevenue > 0
      ? data.revenue.storeRevenue
      : fallbackBlendedRevenue;

  sections.push(`[BRAND] ${data.brandName}`);
  sections.push(`[ΠΕΡΙΟΔΟΣ ΑΝΑΛΥΣΗΣ] ${periodLabel} — όλα τα νούμερα αφορούν ΜΟΝΟ αυτήν την περίοδο.`);

  const evPerAdEuro =
    data.revenue.totalSpend > 0 && data.revenue.roas > 0
      ? `Από τα συστήματα διαφημίσεων: περίπου ${formatNumber(data.revenue.roas, 1)}€ έσοδα για κάθε 1€ διαφημιστικής δαπάνης.`
      : 'Δεν υπάρχει αξιόπιστος λόγος έσοδα προς δαπάνη για την περίοδο.';

  if (ecActive) {
    sections.push(
      `[ΕΣΟΔΑ — για το κείμενο, μίλα με απλά λόγια]` +
        ` Ο τζίρος από παραγγελίες e-shop (το ίδιο μέτρο που εμφανίζεται ως κύριο σύνολο στο dashboard): ${formatCurrency(headlineRevenue)}.` +
        ` Για διαφορετικό πλαίσιο: τι καταγράφουν ως απόδοση οι διαφημίσεις — οργανικά/σε άλλα κανάλια: ${formatCurrency(data.revenue.totalOrganic)}, τιμές attribution από τις πλατφόρμες ads: ${formatCurrency(data.revenue.totalCampaignRevenue)} (δεν αντικαθιστούν τον τζίρο του καταστήματος).` +
        ` Δαπάνη διαφημίσεων: ${formatCurrency(data.revenue.totalSpend)}.` +
        ` ${evPerAdEuro}` +
        ` Ενεργές καμπάνιες (για πλάτος): ${data.revenue.campaignCount}.` +
        ` Στο briefing, αν αναφέρεις «σύνολο εσόδων» για την επιχείρηση στην περίοδο χωρίς άλλο προσδιορισμό, εννοείς μόνο τον τζίρο e-shop παραπάνω όχι το άθροισμα ή τις τιμές ads.`
    );
  } else {
    sections.push(
      `[ΕΣΟΔΑ — για το κείμενο, μίλα με απλά λόγια]` +
        ` Συνολικά έσοδα (όπως τα βλέπουμε): ${formatCurrency(headlineRevenue)}.` +
        ` Από «οργανική» καταγραφή: ${formatCurrency(data.revenue.totalOrganic)}, από διαφημίσεις (platforms): ${formatCurrency(data.revenue.totalCampaignRevenue)}.` +
        ` Δαπάνη διαφημίσεων: ${formatCurrency(data.revenue.totalSpend)}.` +
        ` ${evPerAdEuro}` +
        ` Ενεργές καμπάνιες (για πλάτος): ${data.revenue.campaignCount}.`
    );
  }

  if (ecActive && data.revenue.storeRevenue === 0) {
    sections.push(
      `[ΗΛΕΚΤΡΟΝΙΚΟ ΚΑΤΑΣΤΗΜΑ]` +
        ` Υπάρχουν δεδομένα e-shop στο Performance+ για την επωνυμία, αλλά ο τζίρος στην επιλεγμένη περίοδο είναι 0 (${formatNumber(data.revenue.orderCount)} παραγγελίες). Αυτό μπορεί να σημαίνει κενό διάστημα ή ότι πρέπει να ελεγχθεί sync/imports — μη συγχέεις τα ads figures με τα έσοδα καταστήματος.`
    );
  } else if (data.revenue.storeRevenue > 0) {
    const storePerAd =
      data.revenue.totalSpend > 0 && data.revenue.trueRoas > 0
        ? `Από πραγματικές παραγγελίες e-shop: περίπου ${formatNumber(data.revenue.trueRoas, 1)}€ τζίρος ανά 1€ διαφήμισης.`
        : '';
    sections.push(
      `[ΗΛΕΚΤΡΟΝΙΚΟ ΚΑΤΑΣΤΗΜΑ]` +
        ` Τζίρος από παραγγελίες: ${formatCurrency(data.revenue.storeRevenue)}, παραγγελίες: ${formatNumber(data.revenue.orderCount)}, μέσο καλάθι: ${formatCurrency(data.revenue.aov)}.` +
        ` ${storePerAd}` +
        ` Διαφορά τζίρου καταστήματος έναντι αυτού που «φαίνεται» από τις διαφημίσεις: ${formatCurrency(data.revenue.revenueGap)} (θετικό = ο καταστηματάρχης εισπράττει περισσότερα από όσα καταγράφει μόνο το ads attribution).`
    );
  }

  if (data.ga4) {
    const wc = data.ga4.weeklyChange;
    const fmt = (v: number | null) => v !== null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : 'N/A';
    sections.push(`[TRAFFIC] Sessions: ${formatNumber(data.ga4.sessions)}, Users: ${formatNumber(data.ga4.users)}, New Users: ${formatNumber(data.ga4.newUsers)}, Conversions: ${formatNumber(data.ga4.conversions)}, Bounce: ${data.ga4.bounceRate.toFixed(1)}%${wc ? `, Weekly Δ: Sessions ${fmt(wc.sessions)}, Users ${fmt(wc.users)}, Conversions ${fmt(wc.conversions)}` : ''}`);
  }

  const inv = data.inventory;
  sections.push(
    `[INVENTORY] ${inv.totalProducts} προϊόντα: ${inv.deadStock} σε αδράνεια, ${inv.lowStock} με χαμηλό απόθεμα, ${inv.excessStock} με πλεονάζον απόθεμα${inv.deadStockValue > 0 ? `, Δεσμευμένο κεφάλαιο σε αδρανές απόθεμα: ${formatCurrency(inv.deadStockValue)}` : ''}${inv.lowStockTopNames.length > 0 ? `, Προϊόντα ζήτησης με χαμηλό απόθεμα: ${inv.lowStockTopNames.join(', ')}` : ''}`
  );

  if (data.segments.total > 0) {
    sections.push(`[SEGMENTS] ${data.segments.total} segments, ${formatNumber(data.segments.totalCustomers)} πελάτες, At Risk: ${data.segments.atRiskPct.toFixed(1)}%, Champions: ${data.segments.championsPct.toFixed(1)}%`);
  }

  const campParts: string[] = [];
  if (data.campaigns.topPerformer) {
    campParts.push(
      `Ισχυρότερη: «${data.campaigns.topPerformer.name}» — περίπου ${data.campaigns.topPerformer.roas.toFixed(1)}× έσοδα ανά 1€ δαπάνης (όρος τεχνικός: μην τον επαναλάβεις στο κείμενο πάνω από μία φορά).`
    );
  }
  if (data.campaigns.worstPerformer) {
    campParts.push(
      `Αδύναμη: «${data.campaigns.worstPerformer.name}» — ~${data.campaigns.worstPerformer.roas.toFixed(1)}× έσοδα/δαπάνη, δαπάνη ${formatCurrency(data.campaigns.worstPerformer.spend)}`
    );
  }
  if (campParts.length > 0) sections.push(`[ΚΑΜΠΑΝΙΕΣ — μία φράση στο narrative] ${campParts.join(' | ')}`);

  if (data.alerts.count > 0) {
    sections.push(`[ALERTS] ${data.alerts.count} ενεργά (${data.alerts.critical} critical)${data.alerts.topAlerts.length > 0 ? ': ' + data.alerts.topAlerts.join(' | ') : ''}`);
  }

  if (updateContext) {
    sections.push(`\n[ΣΗΜΑΝΤΙΚΗ ΑΛΛΑΓΗ] ${updateContext} — Δώσε έμφαση σε αυτήν την αλλαγή στο narrative.`);
  }

  sections.push(
    '\n[ΣΤΥΛ BRIEFING] Γλώσσα διοίκησης: σαφής, νηφάλια και φυσική. Εξήγησε τι σημαίνουν τα νούμερα για αποφάσεις και προτεραιότητες, χωρίς τεχνικό στόμφο, hype ή αχρείαστα αγγλικά.'
  );

  return sections.join('\n');
}

const SYSTEM_PROMPT = `Είσαι σύμβουλος ανάπτυξης για μικρομεσαίο e-commerce. Γράφεις το «πρωινό briefing» στο Performance+, όχι ως τεχνικό manual αλλά ως σύντομο ενημερωτικό σημείωμα για ιδιοκτήτη ή διοικητικό υπεύθυνο.

ΜΟΡΦΗ (ΑΥΣΤΗΡΑ):
Μόνο valid JSON:
{
  "narrative": "1 παράγραφος (3-5 προτάσεις)",
  "actions": ["Ενέργεια 1", "Ενέργεια 2", "Ενέργεια 3"]
}

ΓΛΩΣΣΑ & ΤΟΝΟΣ:
- Καθαρά, επαγγελματικά ελληνικά. Η ροή να θυμίζει σύντομο σημείωμα διοίκησης, όχι λίστα KPI.
- Ο τόνος να είναι τεχνοκρατικός, ήρεμος και κατανοητός. Απόφυγε εντυπωσιασμούς, συνθηματολογία και περιττή οικειότητα.
- Απόφυγε αγγλικούς όρους όπως ROAS, blended ή gap στο narrative. Αν χρειάζεται η έννοια, απόδωσέ την με φυσικά ελληνικά.
- ΜΗΝ εξηγείς πολλές διαφορετικές εκδοχές απόδοσης στο ίδιο κείμενο. Μία σαφής αναφορά στην αποδοτικότητα της διαφημιστικής δαπάνης αρκεί. Αν υπάρχουν στοιχεία ηλεκτρονικού καταστήματος, πρόσθεσε μόνο μία σύντομη φράση για τη σχέση τους με όσα καταγράφουν οι διαφημίσεις.
- Ξεκίνα με κάτι συγκεκριμένο και ενδιαφέρον (νούμερο ή αλλαγή), όχι με γενικόλογο εισαγωγικό.
- Χρησιμοποίησε τα νούμερα από τα blocks δεδομένων· μην επινοείς.
- Αν υπάρχει [ΣΗΜΑΝΤΙΚΗ ΑΛΛΑΓΗ], ξεκίνα από αυτήν και εξήγησε σύντομα γιατί επηρεάζει τις σημερινές αποφάσεις.

ΠΕΡΙΕΧΟΜΕΝΟ NARRATIVE:
- Κάλυψε με ισορροπία: έσοδα/δαπάνη (απλά), έπειτα το πιο επείγον από απόθεμα ή καμπάνια, χωρίς επανάληψη.
- Μην γεμίζεις με αρνητικότητα· αν υπάρχει θετικό σημείο, χώρεσέ το μία φορά.

ACTIONS (ακριβώς 3):
- Σύντομες, εφαρμόσιμες και σαφείς, σαν λίστα προτεραιοτήτων της ημέρας.
- Κάθε ενέργεια διαφορετικός τομέας (καμπάνιες, απόθεμα, πελάτες/segments, traffic, τιμές, περιεχόμενο).
- Ξεκίνα με ρήμα (Ελέγξτε, Δείτε, Σταματήστε, Ενεργοποιήστε, Ανοίξτε, Αυξήστε…).
- Max ~15 λέξεις ανά ενέργεια.

ΜΗΝ βάλεις markdown ή emojis. ΜΗΝ γράψεις τίποτα εκτός JSON.`;

// ── Data Hash ────────────────────────────────────────────────────────────────

/** Για να κρίνουμε αν το cached briefing αντιστοιχεί ακόμα στα KPI μετά από φόρτωση raw orders. */
export function computeBriefingDataHash(data: BriefingData): string {
  const key = [
    data.revenue.totalOrganic,
    data.revenue.totalCampaignRevenue,
    data.revenue.storeRevenue,
    data.revenue.orderCount,
    data.revenue.totalSpend,
    data.inventory.totalProducts,
    data.inventory.deadStock,
    data.inventory.lowStock,
    data.segments.totalCustomers,
    data.alerts.count,
    data.ga4?.sessions ?? 0,
  ].join('|');
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

// ── Cache ────────────────────────────────────────────────────────────────────

const MAX_DAILY_GENERATIONS = 4;
const MIN_REGEN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour cooldown between auto-updates

/** Calendar day in local timezone (YYYY-MM-DD) — consistent with «σήμερα» για τον χρήστη */
export function getLocalDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function briefingResultFromCache(c: CachedBriefing): BriefingResult {
  return {
    narrative: c.narrative,
    actions: c.actions,
    generatedAt: c.generatedAt,
    dataHash: c.dataHash,
    urgency: c.urgency,
    updateReason: c.updateReason,
  };
}

export async function getCachedBriefing(brandId: string, period = 'current_month'): Promise<CachedBriefing | null> {
  try {
    const localKey = getLocalDateKey();
    const docId = `${localKey}:${period}`;
    const refLocal = doc(db, 'brands', brandId, 'briefings', docId);
    const snap = await getDoc(refLocal);
    if (snap.exists()) return snap.data() as CachedBriefing;
    return null;
  } catch {
    return null;
  }
}

async function saveBriefingCache(
  brandId: string,
  result: BriefingResult,
  snapshot: MetricsSnapshot,
  prevGenCount: number,
  period = 'current_month',
): Promise<void> {
  try {
    const today = getLocalDateKey();
    const docId = `${today}:${period}`;
    const ref = doc(db, 'brands', brandId, 'briefings', docId);
    const cached: CachedBriefing = {
      ...result,
      _cachedAt: Date.now(),
      _genCount: prevGenCount + 1,
      _snapshot: snapshot,
    };
    await setDoc(ref, cached);
  } catch { /* non-critical */ }
}

// ── Main: Generate Briefing ──────────────────────────────────────────────────

export async function generateMorningBriefing(
  brandId: string,
  data: BriefingData,
  options: { updateReason?: string; period?: string; periodLabel?: string } = {},
): Promise<BriefingResult> {
  const period = options.period ?? 'current_month';
  const periodLabel = options.periodLabel ?? 'Τρέχων Μήνας';
  const dataHash = computeBriefingDataHash(data);
  const snapshot = extractSnapshot(data);
  const existing = await getCachedBriefing(brandId, period);

  const prevGenCount = existing?._genCount ?? 0;

  const userPrompt = buildBriefingPrompt(data, periodLabel, options.updateReason);

  const raw = await callGemini({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.4,
  });

  let parsed: { narrative: string; actions: string[] };
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch {
    parsed = {
      narrative: raw.replace(/```json|```/g, '').trim(),
      actions: [],
    };
  }

  const urgency: BriefingUrgency = options.updateReason ? 'updated' : 'normal';

  const result: BriefingResult = {
    narrative: parsed.narrative || raw,
    actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 3) : [],
    generatedAt: new Date().toISOString(),
    dataHash,
    urgency,
    updateReason: options.updateReason,
  };

  await saveBriefingCache(brandId, result, snapshot, prevGenCount, period);
  return result;
}

// ── Smart Auto-Update Check ──────────────────────────────────────────────────

export async function checkAndAutoUpdate(
  brandId: string,
  data: BriefingData,
  period = 'current_month',
  periodLabel = 'Τρέχων Μήνας',
): Promise<{ updated: boolean; result: BriefingResult | null }> {
  const cached = await getCachedBriefing(brandId, period);

  if (!cached) {
    const result = await generateMorningBriefing(brandId, data, { period, periodLabel });
    return { updated: true, result };
  }

  if (cached._genCount >= MAX_DAILY_GENERATIONS) {
    return { updated: false, result: null };
  }

  if (Date.now() - cached._cachedAt < MIN_REGEN_INTERVAL_MS) {
    return { updated: false, result: null };
  }

  if (!cached._snapshot) {
    return { updated: false, result: null };
  }

  const signal = detectSignificantChange(data, cached._snapshot);
  if (!signal.significant) {
    return { updated: false, result: null };
  }

  const result = await generateMorningBriefing(brandId, data, {
    updateReason: signal.reason,
    period,
    periodLabel,
  });
  return { updated: true, result };
}
