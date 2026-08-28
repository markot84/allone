import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { logger } from './utils/logger';
import { ALERT } from './utils/alertKeys';
import { CONNECTOR_DOC_KEY } from './connectorSyncStatus';

let _db: Firestore;
function db() {
  if (!_db) _db = getFirestore();
  return _db;
}

interface TriggerConfig {
  enabled: boolean;
  threshold?: number;
  checkIntervalDays: number;
  lastCheckedAt?: string;
  autoBriefing: boolean;
}

interface AutomationSettings {
  triggers: Record<string, TriggerConfig>;
}

interface ProductAggregates {
  totalSkus: number;
  totalInventoryValue: number;
  deadStock: { count: number; value: number };
  lowStock: { count: number };
  healthyStock: { count: number };
  excessStock: { count: number; value: number };
  avgMargin: number;
}

interface SegmentAggregates {
  totalCustomers: number;
  atRiskPercentage: number;
  championsPercentage: number;
}

interface CampaignAggregates {
  totalCampaigns: number;
  totalSpend: number;
  totalRevenue: number;
  avgRoas: number;
  topByRoas: { name: string; roas: number; spend: number; revenue: number }[];
  worstByRoas: { name: string; roas: number; spend: number; revenue: number }[];
}

type AlertSeverity = 'info' | 'warning' | 'critical';

/** connectors/{brandId} doc: per-connector state maps (PER-193). */
type ConnectorStates = Record<string, { connected?: boolean; lastSyncError?: string }> | null;

/** doc key → display label, inverted from the nightly-wave map. */
const CONNECTOR_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(CONNECTOR_DOC_KEY).map(([label, key]) => [key, label])
);

/** Human phrase for an email/alert — raw error text stays in data.failing only. */
function humanizeSyncError(error: string): string {
  if (/401|403|token|expired|unauthoriz|unauthentic|reconnect|invalid_grant|access/i.test(error)) {
    return 'Η σύνδεση έληξε — χρειάζεται επανασύνδεση';
  }
  if (/deadline|timeout|timed out|unavailable|503|502|econnreset|etimedout|network/i.test(error)) {
    return 'Προσωρινό σφάλμα επικοινωνίας — θα επαναληφθεί αυτόματα';
  }
  return 'Σφάλμα συγχρονισμού — δείτε λεπτομέρειες στην εφαρμογή';
}

interface NewAlert {
  triggerId: string;
  triggerLabel: string;
  triggerGroup: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  suggestions: string[];
  data: Record<string, unknown>;
}

export const SERVER_TRIGGERS: Record<string, {
  label: string;
  group: string;
  defaultThreshold: number;
  evaluate: (
    threshold: number,
    products: ProductAggregates | null,
    segments: SegmentAggregates | null,
    campaigns: CampaignAggregates | null,
    connectors: ConnectorStates,
  ) => NewAlert | null;
}> = {
  sync_failure_alert: {
    label: 'Sync Failure Alert',
    group: 'data',
    defaultThreshold: 0,
    evaluate: (_threshold, _products, _segments, _campaigns, connectors) => {
      if (!connectors) return null;
      const failing = Object.entries(connectors)
        .filter(([, s]) => s && typeof s === 'object' && s.connected === true && s.lastSyncError)
        .map(([id, s]) => ({ id, label: CONNECTOR_LABEL[id] || id, error: String(s.lastSyncError).slice(0, 200) }));
      if (failing.length === 0) return null;
      return {
        triggerId: 'sync_failure_alert',
        triggerLabel: 'Sync Failure Alert',
        triggerGroup: 'data',
        severity: 'critical',
        title: `Αποτυχία συγχρονισμού: ${failing.map((f) => f.label).join(', ')}`,
        description: failing.map((f) => `${f.label}: ${humanizeSyncError(f.error)}`).join(' · '),
        suggestions: [
          'Ελέγξτε τη σύνδεση στη σελίδα Δεδομένα → Συνδέσεις',
          'Αν το token έχει λήξει, κάντε επανασύνδεση του connector',
        ],
        data: { failing },
      };
    },
  },

  dead_stock_alert: {
    label: 'Dead Stock Alert',
    group: 'inventory',
    defaultThreshold: 15,
    evaluate: (threshold, products) => {
      if (!products || products.totalSkus === 0) return null;
      const pct = (products.deadStock.count / products.totalSkus) * 100;
      if (pct <= threshold) return null;
      return {
        triggerId: 'dead_stock_alert',
        triggerLabel: 'Dead Stock Alert',
        triggerGroup: 'inventory',
        severity: pct > 30 ? 'critical' : 'warning',
        title: `Dead stock στο ${pct.toFixed(1)}% (${products.deadStock.count} SKUs)`,
        description: `Το dead stock ξεπέρασε το όριο του ${threshold}%. Δεσμευμένο κεφάλαιο: €${products.deadStock.value.toFixed(0)}.`,
        suggestions: [
          'Εξετάστε εκκαθάριση ή bundling των dead stock SKUs',
          'Ελέγξτε αν υπάρχουν προϊόντα που μπορούν να επανενεργοποιηθούν',
        ],
        data: { deadStockPct: pct, deadStockCount: products.deadStock.count, deadStockValue: products.deadStock.value },
      };
    },
  },

  excess_stock_alert: {
    label: 'Excess Stock Alert',
    group: 'inventory',
    defaultThreshold: 10000,
    evaluate: (threshold, products) => {
      if (!products || products.excessStock.value <= threshold) return null;
      return {
        triggerId: 'excess_stock_alert',
        triggerLabel: 'Excess Stock Alert',
        triggerGroup: 'inventory',
        severity: products.excessStock.value > threshold * 2 ? 'critical' : 'warning',
        title: `Excess stock €${products.excessStock.value.toFixed(0)} (${products.excessStock.count} SKUs)`,
        description: `Η αξία excess stock ξεπέρασε το όριο των €${threshold}.`,
        suggestions: [
          'Δημιουργήστε προσφορές ή bundles για τα excess SKUs',
          'Μειώστε τις παραγγελίες αναπλήρωσης',
        ],
        data: { excessValue: products.excessStock.value, excessCount: products.excessStock.count },
      };
    },
  },

  low_stock_critical: {
    label: 'Low Stock Critical',
    group: 'inventory',
    defaultThreshold: 5,
    evaluate: (threshold, products) => {
      if (!products || products.lowStock.count < threshold) return null;
      return {
        triggerId: 'low_stock_critical',
        triggerLabel: 'Low Stock Critical',
        triggerGroup: 'inventory',
        severity: products.lowStock.count > threshold * 3 ? 'critical' : 'warning',
        title: `${products.lowStock.count} προϊόντα σε χαμηλό απόθεμα`,
        description: `Βρέθηκαν ${products.lowStock.count} SKUs με χαμηλό stock (όριο: ${threshold}).`,
        suggestions: [
          'Ελέγξτε τις παραγγελίες αναπλήρωσης',
          'Προτεραιοποιήστε τα best-sellers με χαμηλό stock',
        ],
        data: { lowStockCount: products.lowStock.count },
      };
    },
  },

  campaign_underperform: {
    label: 'Campaign Underperformance',
    group: 'campaigns',
    defaultThreshold: 1,
    evaluate: (threshold, _products, _segments, campaigns) => {
      if (!campaigns || campaigns.worstByRoas.length === 0) return null;
      const underperformers = campaigns.worstByRoas.filter(c => c.roas < threshold && c.spend > 50);
      if (underperformers.length === 0) return null;
      const top = underperformers[0];
      return {
        triggerId: 'campaign_underperform',
        triggerLabel: 'Campaign Underperformance',
        triggerGroup: 'campaigns',
        severity: underperformers.length > 2 ? 'critical' : 'warning',
        title: `${underperformers.length} campaigns με ROAS < ${threshold}x`,
        description: `Χειρότερη: "${top.name}" — ROAS ${top.roas.toFixed(2)}x, spend €${top.spend.toFixed(0)}.`,
        suggestions: [
          `Παύση ή βελτιστοποίηση "${top.name}"`,
          'Ελέγξτε targeting και δημιουργικά',
        ],
        data: { underperformCount: underperformers.length, worst: top },
      };
    },
  },

  campaign_high_roas: {
    label: 'Campaign High ROAS',
    group: 'campaigns',
    defaultThreshold: 4,
    evaluate: (threshold, _products, _segments, campaigns) => {
      if (!campaigns || campaigns.topByRoas.length === 0) return null;
      const stars = campaigns.topByRoas.filter(c => c.roas > threshold);
      if (stars.length === 0) return null;
      const top = stars[0];
      return {
        triggerId: 'campaign_high_roas',
        triggerLabel: 'Campaign High ROAS',
        triggerGroup: 'campaigns',
        severity: 'info',
        title: `${stars.length} campaigns με ROAS > ${threshold}x`,
        description: `Κορυφαία: "${top.name}" — ROAS ${top.roas.toFixed(2)}x, revenue €${top.revenue.toFixed(0)}.`,
        suggestions: [
          `Αυξήστε το budget σε "${top.name}"`,
          'Δημιουργήστε παρόμοιες καμπάνιες',
        ],
        data: { highRoasCount: stars.length, best: top },
      };
    },
  },

  segment_churn_risk: {
    label: 'Segment Churn Risk',
    group: 'customers',
    defaultThreshold: 20,
    evaluate: (threshold, _products, segments) => {
      if (!segments || segments.totalCustomers === 0) return null;
      if (segments.atRiskPercentage <= threshold) return null;
      return {
        triggerId: 'segment_churn_risk',
        triggerLabel: 'Segment Churn Risk',
        triggerGroup: 'customers',
        severity: segments.atRiskPercentage > threshold * 1.5 ? 'critical' : 'warning',
        title: `At Risk πελάτες στο ${segments.atRiskPercentage.toFixed(1)}%`,
        description: `Το ποσοστό At Risk ξεπέρασε το όριο ${threshold}%. Κίνδυνος απώλειας πελατών.`,
        suggestions: [
          'Δημιουργήστε win-back καμπάνια',
          'Στείλτε εξατομικευμένες προσφορές',
        ],
        data: { atRiskPct: segments.atRiskPercentage },
      };
    },
  },

  segment_vip_growth: {
    label: 'VIP Segment Growth',
    group: 'customers',
    defaultThreshold: 15,
    evaluate: (threshold, _products, segments) => {
      if (!segments || segments.totalCustomers === 0) return null;
      if (segments.championsPercentage <= threshold) return null;
      return {
        triggerId: 'segment_vip_growth',
        triggerLabel: 'VIP Segment Growth',
        triggerGroup: 'customers',
        severity: 'info',
        title: `Champions στο ${segments.championsPercentage.toFixed(1)}%`,
        description: `Οι Champions/VIP πελάτες ξεπέρασαν το ${threshold}%. Εξαιρετική πορεία!`,
        suggestions: [
          'Ενεργοποιήστε loyalty program',
          'Δημιουργήστε referral campaign για Champions',
        ],
        data: { championsPct: segments.championsPercentage },
      };
    },
  },
};

async function getSettings(brandId: string): Promise<AutomationSettings> {
  const snap = await db().doc(`automation_settings/${brandId}`).get();
  if (snap.exists) return snap.data() as AutomationSettings;
  return { triggers: {} };
}

async function getExistingActiveAlerts(brandId: string): Promise<Set<string>> {
  const snap = await db().collection('automation_alerts')
    .where('brandId', '==', brandId)
    .where('status', '==', 'new')
    .get();
  return new Set(snap.docs.map(d => d.data().triggerId as string));
}

async function getAggregates(brandId: string) {
  const aggRef = db().collection('brands').doc(brandId).collection('aggregates');
  const [pSnap, sSnap, cSnap, connSnap] = await Promise.all([
    aggRef.doc('products').get(),
    aggRef.doc('segments').get(),
    aggRef.doc('campaigns').get(),
    db().doc(`connectors/${brandId}`).get(),
  ]);
  return {
    products: pSnap.exists ? (pSnap.data() as ProductAggregates) : null,
    segments: sSnap.exists ? (sSnap.data() as SegmentAggregates) : null,
    campaigns: cSnap.exists ? (cSnap.data() as CampaignAggregates) : null,
    connectors: connSnap.exists ? (connSnap.data() as ConnectorStates) : null,
  };
}

async function evaluateBrand(brandId: string): Promise<number> {
  const [settings, activeAlerts, aggregates] = await Promise.all([
    getSettings(brandId),
    getExistingActiveAlerts(brandId),
    getAggregates(brandId),
  ]);

  const now = new Date();
  let alertsCreated = 0;

  for (const [triggerId, def] of Object.entries(SERVER_TRIGGERS)) {
    const config = settings.triggers[triggerId];
    if (!config?.enabled) continue;
    if (activeAlerts.has(triggerId)) continue;

    if (config.lastCheckedAt) {
      const lastCheck = new Date(config.lastCheckedAt);
      const daysSince = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < config.checkIntervalDays) continue;
    }

    const threshold = config.threshold ?? def.defaultThreshold;
    const result = def.evaluate(threshold, aggregates.products, aggregates.segments, aggregates.campaigns, aggregates.connectors);

    await db().doc(`automation_settings/${brandId}`).set({
      triggers: { [triggerId]: { lastCheckedAt: now.toISOString() } },
    }, { merge: true });

    if (result) {
      const alertId = `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await db().collection('automation_alerts').doc(alertId).set({
        ...result,
        id: alertId,
        brandId,
        status: 'new',
        createdAt: now.toISOString(),
      });
      alertsCreated++;
      logger.info(`[ServerAlerts] ${brandId}: fired ${triggerId} (${result.severity})`);
    }
  }

  return alertsCreated;
}

export async function evaluateAllBrandsServerSide(): Promise<{ brands: number; alerts: number }> {
  const brandsSnap = await db().collection('brands').get();
  let totalAlerts = 0;
  let brandsProcessed = 0;

  for (const doc of brandsSnap.docs) {
    try {
      const count = await evaluateBrand(doc.id);
      totalAlerts += count;
      brandsProcessed++;
    } catch (err) {
      logger.error(`[ServerAlerts] Failed for brand ${doc.id}:`, { alertKey: ALERT.serverAlertEvalFailed, err });
    }
  }

  logger.info(`[ServerAlerts] Done: ${brandsProcessed} brands, ${totalAlerts} new alerts`);
  return { brands: brandsProcessed, alerts: totalAlerts };
}
