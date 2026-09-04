import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { buildAdvisorySystemPrompt } from '../data/aiAdvisoryFramework';
import { callGemini } from './geminiProxy';
import { calculateCampaignMetrics, sumDailyRevenueInPeriod } from '../utils/roiUtils';
import { formatIsoRangeLabelGr, isIsoDay, shiftPeriodByYears } from '../utils/periodComparison';
import { formatCurrency, formatNumber } from '../utils/format';
import { parseJsonObject } from '../utils/aiJson';
import type { Campaign, RFMSegment, AutomationAlert } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface BriefingData {
  revenue: {
    totalOrganic: number;
    totalCampaignRevenue: number;
    storeRevenue: number;
    /** When true, the dashboard's "Total Revenue" = order revenue (storeRevenue), even if 0 — not a blend of organic+ads. */
    ecommerceSourceActive: boolean;
    trueRoas: number;
    revenueGap: number;
    orderCount: number;
    aov: number;
    totalSpend: number;
    roas: number;
    campaignCount: number;
    /** False while the campaign query is still in flight. An empty list then means "not loaded",
     * never "no advertising ran" — the prompt must not reason from it. */
    campaignsLoaded: boolean;
  };
  dataQuality: {
    ecommerceLatestPositiveRevenueDay: string | null;
    ecommerceDaysSinceLatestRevenue: number | null;
    ecommerceAggregateSyncedHoursAgo: number | null;
    suspectedEcommerceSyncGap: boolean;
  };
  ga4: {
    sessions: number;
    users: number;
    newUsers: number;
    bounceRate: number;
    conversions: number;
    weeklyChange: { sessions: number | null; users: number | null; conversions: number | null } | null;
  } | null;
  /** Null when Product Intelligence has no aggregate for the brand — the briefing then says
    * nothing about stock rather than inventing figures. */
  inventory: BriefingInventory | null;
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
  yearOverYear?: BriefingYearOverYear;
}

/** Inventory exactly as Product Intelligence reports it: whole catalog, the brand's stock-health
 * thresholds, parent grouping — the same numbers the Product Intelligence page shows. The briefing
 * must never recount these from a page of products. */
export interface BriefingInventory {
  totalProducts: number;
  deadStock: number;
  lowStock: number;
  excessStock: number;
  /** Capital sitting in dead stock. */
  deadStockCapital: number;
  /** True when `deadStockCapital` is cost×stock (δεσμευμένο κεφάλαιο); false = retail×stock. */
  deadStockCapitalIsCost: boolean;
  /** Names from the PI "low stock" bucket, for the prose. */
  lowStockTopNames: string[];
}

export interface BriefingYearOverYear {
  previousPeriodLabel: string;
  previous: {
    revenue: number;
    orders: number;
    /** Ad cost — the Campaigns table's Cost column (`amount_spent`), not budgeted marketing overhead. */
    spend: number;
    /** True ROAS: e-shop turnover ÷ ad spend. Never the platforms' attributed ROAS. */
    trueRoas: number;
    sessions: number;
  };
  hasPreviousData: boolean;
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
  _schemaVersion?: number;
}

// ── Data Collector ───────────────────────────────────────────────────────────

export function collectBriefingData(params: {
  campaigns: Campaign[];
  segments: RFMSegment[];
  /** Organic $ for the same period as the campaigns / e-shop in the snapshot (e.g. dashboard period). */
  totalOrganicRevenue: number;
  ga4: {
    totals: { sessions: number; users: number; newUsers: number; bounceRate: number; conversions: number };
    weeklyChange: { sessions: number | null; users: number | null; conversions: number | null } | null;
    hasData: boolean;
  };
  alerts: AutomationAlert[];
  brandName: string;
  /** False while campaigns are still loading; defaults to true. See `revenue.campaignsLoaded`. */
  campaignsLoaded?: boolean;
  /** From Product Intelligence — see `BriefingInventory`. Null/omitted ⇒ no stock section. */
  inventory?: BriefingInventory | null;
  ecommerce?: {
    hasData: boolean;
    totalRevenue: number;
    orderCount: number;
    aov: number;
    connectedPlatforms: string[];
    topPlatform?: string;
    dataFreshness?: {
      latestPositiveRevenueDay: string | null;
      daysSinceLatestRevenue: number | null;
      aggregateSyncedHoursAgo?: number | null;
      suspectedSyncGap: boolean;
    };
  };
  /** Same window one year back — see `computeBriefingYearOverYear`. Omitted when not comparable. */
  yearOverYear?: BriefingYearOverYear;
}): BriefingData {
  const { campaigns, segments, totalOrganicRevenue, ga4, alerts, brandName, campaignsLoaded, inventory, ecommerce, yearOverYear } = params;

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
      campaignsLoaded: campaignsLoaded ?? true,
    },
    dataQuality: {
      ecommerceLatestPositiveRevenueDay: ecommerce?.dataFreshness?.latestPositiveRevenueDay ?? null,
      ecommerceDaysSinceLatestRevenue: ecommerce?.dataFreshness?.daysSinceLatestRevenue ?? null,
      ecommerceAggregateSyncedHoursAgo: ecommerce?.dataFreshness?.aggregateSyncedHoursAgo ?? null,
      suspectedEcommerceSyncGap: Boolean(ecommerce?.dataFreshness?.suspectedSyncGap),
    },
    ga4: ga4.hasData ? {
      sessions: ga4.totals.sessions,
      users: ga4.totals.users,
      newUsers: ga4.totals.newUsers,
      bounceRate: ga4.totals.bounceRate,
      conversions: ga4.totals.conversions,
      weeklyChange: ga4.weeklyChange,
    } : null,
    inventory: inventory ?? null,
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
    ...(yearOverYear ? { yearOverYear } : {}),
  };
}

/** The one revenue figure the briefing treats as headline, in every place it is quoted:
 * the e-shop order turnover when that source is active (or non-zero anyway), otherwise the
 * organic + ads-attributed blend. Snapshot, prompt and the YoY strip must all agree. */
export function briefingHeadlineRevenue(input: {
  ecommerceSourceActive: boolean;
  storeRevenue: number;
  organicRevenue: number;
  campaignRevenue: number;
}): number {
  if (input.ecommerceSourceActive) return input.storeRevenue;
  if (input.storeRevenue > 0) return input.storeRevenue;
  return input.organicRevenue + input.campaignRevenue;
}

// ── Year-over-Year ───────────────────────────────────────────────────────────

/** Sums the day-keyed order rows inside an inclusive window. */
function sumOrdersInPeriod(
  ordersByDay: { date: string; orders: number }[],
  fromDate: string,
  toDate: string,
): number {
  return ordersByDay.reduce(
    (sum, r) => (r.date >= fromDate && r.date <= toDate ? sum + (Number(r.orders) || 0) : sum),
    0,
  );
}

/** Sums GA4 sessions inside an inclusive window. */
function sumSessionsInPeriod(
  dailyEntries: { date: string; sessions: number }[],
  fromDate: string,
  toDate: string,
): number {
  return dailyEntries.reduce(
    (sum, d) => (d.date >= fromDate && d.date <= toDate ? sum + (Number(d.sessions) || 0) : sum),
    0,
  );
}

/** The same window one calendar year back, measured the same way as the current period.
 *
 * Returns `undefined` when the comparison cannot be made at all — malformed dates, or a
 * previous window that ends before the brand's `historyStartDate` (data we deliberately
 * never read). A window we CAN read but that turns out empty comes back with
 * `hasPreviousData: false`, so callers stay silent instead of reporting a false -100%. */
export function computeBriefingYearOverYear(params: {
  period: { fromDate: string; toDate: string };
  /** Mirrors `BriefingData.revenue.ecommerceSourceActive` — selects the revenue measure. */
  ecommerceSourceActive: boolean;
  /** Full-history e-shop revenue per day (YYYY-MM-DD → €). */
  revenueByDay?: Record<string, number>;
  /** Full-history e-shop orders per day. */
  ordersByDay?: { date: string; orders: number }[];
  /** Campaigns already schedule-scoped and prorated to the PREVIOUS window. */
  previousCampaigns?: Campaign[];
  /** Full-history GA4 daily rows. */
  ga4DailyEntries?: { date: string; sessions: number }[];
  /** Organic € for the previous window, derived exactly like the current period's. */
  previousOrganicRevenue?: number;
  /** Brand read-side history cutoff (YYYY-MM-DD). */
  historyStartDate?: string | null;
}): BriefingYearOverYear | undefined {
  const { fromDate, toDate } = params.period;
  if (!isIsoDay(fromDate) || !isIsoDay(toDate) || fromDate > toDate) return undefined;

  const previousPeriod = shiftPeriodByYears({ fromDate, toDate }, -1);
  const cutoff = params.historyStartDate?.trim();
  // Nothing of the previous window survives the brand's history clamp → not comparable.
  if (cutoff && isIsoDay(cutoff) && previousPeriod.toDate < cutoff) return undefined;

  const metrics = calculateCampaignMetrics(params.previousCampaigns ?? []);
  const storeRevenue = sumDailyRevenueInPeriod(params.revenueByDay, previousPeriod.fromDate, previousPeriod.toDate);
  const revenue = briefingHeadlineRevenue({
    ecommerceSourceActive: params.ecommerceSourceActive,
    storeRevenue,
    organicRevenue: params.previousOrganicRevenue ?? 0,
    campaignRevenue: metrics.totalRevenue,
  });

  // True ROAS — store turnover per ad euro, the measure the business decides on.
  const trueRoas = metrics.totalSpend > 0 ? storeRevenue / metrics.totalSpend : 0;
  const orders = sumOrdersInPeriod(params.ordersByDay ?? [], previousPeriod.fromDate, previousPeriod.toDate);
  const sessions = sumSessionsInPeriod(params.ga4DailyEntries ?? [], previousPeriod.fromDate, previousPeriod.toDate);

  return {
    previousPeriodLabel: formatIsoRangeLabelGr(previousPeriod.fromDate, previousPeriod.toDate),
    previous: {
      revenue: Math.round(revenue),
      orders,
      spend: Math.round(metrics.totalSpend),
      trueRoas,
      sessions,
    },
    hasPreviousData: revenue > 0 || orders > 0 || metrics.totalSpend > 0 || sessions > 0,
  };
}

// ── Metrics Snapshot ─────────────────────────────────────────────────────────

function extractSnapshot(data: BriefingData): MetricsSnapshot {
  const headlineRevenue = briefingHeadlineRevenue({
    ecommerceSourceActive: data.revenue.ecommerceSourceActive,
    storeRevenue: data.revenue.storeRevenue,
    organicRevenue: data.revenue.totalOrganic,
    campaignRevenue: data.revenue.totalCampaignRevenue,
  });
  return {
    totalRevenue: headlineRevenue,
    totalSpend: data.revenue.totalSpend,
    roas: data.revenue.roas,
    deadStock: data.inventory?.deadStock ?? 0,
    lowStock: data.inventory?.lowStock ?? 0,
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
  const ecActive = data.revenue.ecommerceSourceActive;
  const headlineRevenue = briefingHeadlineRevenue({
    ecommerceSourceActive: ecActive,
    storeRevenue: data.revenue.storeRevenue,
    organicRevenue: data.revenue.totalOrganic,
    campaignRevenue: data.revenue.totalCampaignRevenue,
  });

  sections.push(`[BRAND] "${data.brandName}" — ΚΑΝΟΝΑΣ: Όταν αναφέρεσαι στο brand στο κείμενο, γράψε "το brand ${data.brandName}" ή "για το brand ${data.brandName}". ΠΟΤΕ μην χρησιμοποιείς άρθρο γένους (ο/η/ο) πριν από το brand name.`);
  sections.push(`[ΠΕΡΙΟΔΟΣ ΑΝΑΛΥΣΗΣ] ${periodLabel} — όλα τα νούμερα αφορούν ΜΟΝΟ αυτήν την περίοδο.`);

  // True ROAS (τζίρος e-shop ÷ δαπάνη) is the measure that counts; the platforms' attributed
  // ratio is only quoted when there is no e-shop turnover to divide, and is labelled as such.
  const evPerAdEuro =
    data.revenue.totalSpend > 0 && data.revenue.trueRoas > 0
      ? `Πραγματική απόδοση δαπάνης: περίπου ${formatNumber(data.revenue.trueRoas, 1)}€ τζίρος e-shop για κάθε 1€ διαφημιστικής δαπάνης. Αυτό είναι το μέτρο που μετράει — μην αναφέρεις άλλον λόγο απόδοσης.`
      : data.revenue.totalSpend > 0 && data.revenue.roas > 0
        ? `Δεν υπάρχει τζίρος e-shop για να μετρηθεί πραγματική απόδοση· οι πλατφόρμες διαφημίσεων καταγράφουν περίπου ${formatNumber(data.revenue.roas, 1)}€ ανά 1€ δαπάνης, νούμερο attribution και όχι εισπράξεις.`
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

  // Absence of campaign rows is a data gap, not evidence that the brand stopped advertising.
  // Without this the model wrote "τζίρος αποκλειστικά από οργανικές πηγές, χωρίς καμία
  // διαφημιστική υποστήριξη" purely because the connectors had delivered nothing for the window.
  if (data.revenue.campaignCount === 0 && data.revenue.campaignsLoaded) {
    sections.push(
      `[ΔΙΑΦΗΜΙΣΗ — ΠΡΟΣΟΧΗ] Δεν έχουν φτάσει στο Performance+ δεδομένα καμπανιών για αυτή την περίοδο. ` +
        'Αυτό ΔΕΝ σημαίνει ότι δεν έγινε διαφήμιση. ΜΗΝ γράψεις ότι ο τζίρος είναι αποκλειστικά οργανικός, ' +
        'ούτε ότι δεν υπήρξε διαφημιστική υποστήριξη. Ανάφερε ότι λείπουν τα στοιχεία καμπανιών και ότι πρέπει να ελεγχθεί ο συγχρονισμός.'
    );
  }

  if (ecActive && data.revenue.storeRevenue === 0) {
    sections.push(
      `[ΗΛΕΚΤΡΟΝΙΚΟ ΚΑΤΑΣΤΗΜΑ]` +
        ` Υπάρχουν δεδομένα e-shop στο Performance+ για την επωνυμία, αλλά ο τζίρος στην επιλεγμένη περίοδο είναι 0 (${formatNumber(data.revenue.orderCount)} παραγγελίες). Αυτό μπορεί να σημαίνει κενό διάστημα ή ότι πρέπει να ελεγχθεί sync/imports — μη συγχέεις τα ads figures με τα έσοδα καταστήματος.`
    );
  } else if (data.revenue.storeRevenue > 0) {
    sections.push(
      `[ΗΛΕΚΤΡΟΝΙΚΟ ΚΑΤΑΣΤΗΜΑ]` +
        ` Τζίρος από παραγγελίες: ${formatCurrency(data.revenue.storeRevenue)}, παραγγελίες: ${formatNumber(data.revenue.orderCount)}, μέσο καλάθι: ${formatCurrency(data.revenue.aov)}.` +
        ` Διαφορά τζίρου καταστήματος έναντι αυτού που «φαίνεται» από τις διαφημίσεις: ${formatCurrency(data.revenue.revenueGap)} (θετικό = ο καταστηματάρχης εισπράττει περισσότερα από όσα καταγράφει μόνο το ads attribution).`
    );
  }

  if (data.ga4) {
    const wc = data.ga4.weeklyChange;
    const fmt = (v: number | null) => v !== null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : 'N/A';
    sections.push(`[TRAFFIC] Sessions: ${formatNumber(data.ga4.sessions)}, Users: ${formatNumber(data.ga4.users)}, New Users: ${formatNumber(data.ga4.newUsers)}, Conversions: ${formatNumber(data.ga4.conversions)}, Bounce: ${data.ga4.bounceRate.toFixed(1)}%${wc ? `, Τάση εντός περιόδου (οι 7 τελευταίες ημέρες της περιόδου έναντι των 7 προηγούμενων): Sessions ${fmt(wc.sessions)}, Users ${fmt(wc.users)}, Conversions ${fmt(wc.conversions)}` : ''}`);
  }

  const inv = data.inventory;
  if (inv) {
    const capitalLabel = inv.deadStockCapitalIsCost
      ? 'Δεσμευμένο κεφάλαιο σε αδρανές απόθεμα (κόστος κτήσης × απόθεμα)'
      : 'Αξία αδρανούς αποθέματος σε τιμές πώλησης';
    sections.push(
      `[ΑΠΟΘΕΜΑ — πηγή: Product Intelligence, ίδια νούμερα με τη σελίδα· μην τα ξαναϋπολογίσεις]` +
        ` ${formatNumber(inv.totalProducts)} προϊόντα: ${formatNumber(inv.deadStock)} σε αδράνεια, ${formatNumber(inv.lowStock)} με χαμηλό απόθεμα, ${formatNumber(inv.excessStock)} με πλεονάζον απόθεμα` +
        `${inv.deadStockCapital > 0 ? `. ${capitalLabel}: ${formatCurrency(inv.deadStockCapital)}` : ''}` +
        `${inv.lowStockTopNames.length > 0 ? `. Προϊόντα ζήτησης με χαμηλό απόθεμα: ${inv.lowStockTopNames.join(', ')}` : ''}`
    );
  }

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

  if (data.yearOverYear?.hasPreviousData) {
    sections.push(
      `[ΣΥΓΚΡΙΣΗ ΜΕ ΠΕΡΣΙ] Η αντίστοιχη περίοδος πέρσι ήταν ${data.yearOverYear.previousPeriodLabel}. ` +
        `Έσοδα: ${formatCurrency(data.yearOverYear.previous.revenue)}, παραγγελίες: ${formatNumber(data.yearOverYear.previous.orders)}, ` +
        `διαφημιστική δαπάνη (Cost καμπανιών): ${formatCurrency(data.yearOverYear.previous.spend)}, ` +
        `πραγματική απόδοση δαπάνης: ${formatNumber(data.yearOverYear.previous.trueRoas, 1)}x, ` +
        `sessions: ${formatNumber(data.yearOverYear.previous.sessions)}. ` +
        'Μην αναπτύξεις αυτή τη σύγκριση στο narrative· θα προστεθεί αυτόματα στο τέλος.'
    );
  }

  if (updateContext) {
    sections.push(`\n[ΣΗΜΑΝΤΙΚΗ ΑΛΛΑΓΗ] ${updateContext} — Δώσε έμφαση σε αυτήν την αλλαγή στο narrative.`);
  }

  sections.push(
    '\n[ΣΤΥΛ BRIEFING] Γλώσσα διοίκησης: σαφής, νηφάλια και φυσική. Εξήγησε τι σημαίνουν τα νούμερα για αποφάσεις και προτεραιότητες, χωρίς τεχνικό στόμφο, hype ή αχρείαστα αγγλικά.'
  );

  return sections.join('\n');
}

const SYSTEM_PROMPT = buildAdvisorySystemPrompt(`Είσαι σύμβουλος ανάπτυξης για μικρομεσαίο e-commerce. Γράφεις το «πρωινό briefing» στο Performance+, όχι ως τεχνικό manual αλλά ως σύντομο ενημερωτικό σημείωμα για ιδιοκτήτη ή διοικητικό υπεύθυνο.

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

ΜΗΝ βάλεις markdown ή emojis. ΜΗΝ γράψεις τίποτα εκτός JSON.`, { json: true });

// ── Data Hash ────────────────────────────────────────────────────────────────

/** Used to decide whether the cached briefing still matches the KPIs after loading raw orders. */
export function computeBriefingDataHash(data: BriefingData): string {
  const key = [
    data.revenue.totalOrganic,
    data.revenue.totalCampaignRevenue,
    data.revenue.storeRevenue,
    data.revenue.orderCount,
    data.revenue.totalSpend,
    data.inventory?.totalProducts ?? 0,
    data.inventory?.deadStock ?? 0,
    data.inventory?.lowStock ?? 0,
    data.segments.totalCustomers,
    data.alerts.count,
    data.ga4?.sessions ?? 0,
    data.yearOverYear?.previous.revenue ?? 0,
    data.yearOverYear?.previous.orders ?? 0,
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
/** Bump whenever the PROMPT or the data feeding it changes, not only when the cached shape does:
 * a stored briefing is prose written under the old rules and will otherwise be shown until it
 * expires. The data hash covers changing *values*; this covers changing *logic*. Exported so the
 * localStorage copy follows the same number — the two markers had already drifted (v5 vs v4),
 * which is why a rewritten prompt kept serving yesterday's text. */
export const BRIEFING_CACHE_VERSION = 6;

/** Calendar day in local timezone (YYYY-MM-DD) — consistent with "today" for the user */
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
    if (snap.exists()) {
      const cached = snap.data() as CachedBriefing;
      if (cached._schemaVersion !== BRIEFING_CACHE_VERSION) return null;
      return cached;
    }
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
      _schemaVersion: BRIEFING_CACHE_VERSION,
    };
    await setDoc(ref, cached);
  } catch { /* non-critical */ }
}

function buildDataFlowAlertBriefing(
  data: BriefingData,
  dataHash: string,
  updateReason?: string,
): BriefingResult {
  const latest = data.dataQuality.ecommerceLatestPositiveRevenueDay;
  const days = data.dataQuality.ecommerceDaysSinceLatestRevenue;
  const staleText = latest && days !== null
    ? `τελευταία ημέρα με τζίρο ${latest}, δηλαδή ${days} ημέρες πριν το τέλος της περιόδου`
    : 'δεν υπάρχει πρόσφατη ημέρα με θετικό τζίρο στην επιλεγμένη περίοδο';

  return {
    narrative:
      `Ο πίνακας δείχνει τζίρο e-shop ${formatCurrency(data.revenue.storeRevenue)} και ${formatNumber(data.revenue.orderCount)} παραγγελίες για την περίοδο, αλλά η ημερήσια ροή δεδομένων φαίνεται κομμένη: ${staleText}. ` +
      `Δεν το αντιμετωπίζουμε ως μηδενική εμπορική δραστηριότητα για το brand ${data.brandName}, αλλά ως θέμα αξιοπιστίας sync/import που πρέπει να ελεγχθεί πριν βγουν εμπορικά συμπεράσματα. ` +
      `Προτεραιότητα είναι η αποκατάσταση του connector και η επιβεβαίωση ότι οι τελευταίες παραγγελίες περνούν στο Performance+.`,
    actions: [
      'Ελέγξτε άμεσα το τελευταίο sync του e-shop connector.',
      'Επιβεβαιώστε ότι τα credentials/API token παραμένουν ενεργά.',
      'Μετά την αποκατάσταση, επανελέγξτε Revenue Performance και AOV.',
    ],
    generatedAt: new Date().toISOString(),
    dataHash,
    urgency: updateReason ? 'updated' : 'normal',
    updateReason: updateReason ?? 'Έλεγχος ροής δεδομένων',
  };
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

  if (data.dataQuality.suspectedEcommerceSyncGap) {
    const result = buildDataFlowAlertBriefing(data, dataHash, options.updateReason);
    await saveBriefingCache(brandId, result, snapshot, prevGenCount, period);
    return result;
  }

  const userPrompt = buildBriefingPrompt(data, periodLabel, options.updateReason);

  const raw = await callGemini({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.4,
  });

  const parsed = parseJsonObject<{ narrative?: unknown; actions?: unknown }>(raw) ?? {
    narrative: raw.replace(/```json|```/g, '').trim(),
    actions: [],
  };

  const urgency: BriefingUrgency = options.updateReason ? 'updated' : 'normal';

  const result: BriefingResult = {
    narrative: typeof parsed.narrative === 'string' && parsed.narrative.trim() ? parsed.narrative : raw,
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
