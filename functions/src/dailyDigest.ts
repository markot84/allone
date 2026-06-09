import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import type { Transporter } from 'nodemailer';
import { createTransporter, SENDER, NOREPLY_EMAIL, type SmtpCredentialInput } from './smtpConfig';
import { escapeHtml } from './escapeHtml';

let _db: Firestore;
function db() {
  if (!_db) _db = getFirestore();
  return _db;
}

interface AlertDoc {
  triggerId: string;
  triggerLabel: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  status: string;
  createdAt: string;
}

interface ProductAgg {
  totalSkus: number;
  deadStock: { count: number; value: number };
  totalInventoryValue: number;
}

interface SegmentAgg {
  totalCustomers: number;
  atRiskPercentage: number;
  championsPercentage: number;
}

interface CampaignAgg {
  totalCampaigns: number;
  totalSpend: number;
  totalRevenue: number;
  avgRoas: number;
}

interface PeriodMetrics {
  dateKey: string;
  label: string;
  paidSpend: number;
  paidRevenue: number;
  paidRoas: number;
  storeRevenue: number;
  storeOrders: number;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };
const SEVERITY_COLORS: Record<string, string> = {
  critical: '#DC2626',
  warning: '#F59E0B',
  info: '#3B82F6',
};
const SEVERITY_LABELS: Record<string, string> = {
  critical: 'ΚΡΙΣΙΜΟ',
  warning: 'ΠΡΟΣΟΧΗ',
  info: 'INFO',
};

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `€${(n / 1_000).toFixed(1)}K`;
  return `€${n.toFixed(0)}`;
}

function athensDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function digestPeriod(): { dateKey: string; label: string } {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dateKey = athensDateKey(yesterday);
  const label = yesterday.toLocaleDateString('el-GR', {
    timeZone: 'Europe/Athens',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return { dateKey, label };
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dailyMap(value: unknown): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, Record<string, unknown>>;
}

async function loadPeriodMetrics(brandId: string, period: { dateKey: string; label: string }): Promise<PeriodMetrics> {
  const [campaignsSnap, businessSnap, ecommerceSnap] = await Promise.all([
    db().collection('campaigns').where('brandId', '==', brandId).get(),
    db().doc(`business_revenue_summary/${brandId}`).get(),
    db().doc(`ecommerce_summary/${brandId}`).get(),
  ]);

  let paidSpend = 0;
  let paidRevenue = 0;
  campaignsSnap.docs.forEach((doc) => {
    const day = dailyMap(doc.data().dailyMetrics)[period.dateKey];
    if (!day) return;
    paidSpend += asNumber(day.amount_spent);
    paidRevenue += asNumber(day.purchase_conversion_value || day.conversion_value);
  });

  const business = businessSnap.exists ? businessSnap.data() || {} : {};
  const ecommerce = ecommerceSnap.exists ? ecommerceSnap.data() || {} : {};
  const businessRevenueByDay = (business.revenueByDay || {}) as Record<string, unknown>;
  const ecommerceRevenueByDay = (ecommerce.revenueByDay || {}) as Record<string, unknown>;
  const businessOrdersByDay = (business.ordersByDay || {}) as Record<string, unknown>;
  const ecommerceOrdersByDay = (ecommerce.ordersByDay || {}) as Record<string, unknown>;
  const storeRevenue = asNumber(businessRevenueByDay[period.dateKey] ?? ecommerceRevenueByDay[period.dateKey]);
  const storeOrders = asNumber(businessOrdersByDay[period.dateKey] ?? ecommerceOrdersByDay[period.dateKey]);

  return {
    ...period,
    paidSpend: Math.round(paidSpend * 100) / 100,
    paidRevenue: Math.round(paidRevenue * 100) / 100,
    paidRoas: paidSpend > 0 ? paidRevenue / paidSpend : 0,
    storeRevenue,
    storeOrders,
  };
}

function buildAlertRow(alert: AlertDoc): string {
  const color = SEVERITY_COLORS[alert.severity] || '#6B7280';
  const label = SEVERITY_LABELS[alert.severity] || 'INFO';
  return `
    <tr>
      <td style="padding: 10px 16px; border-bottom: 1px solid #F3F4F6;">
        <span style="display: inline-block; padding: 2px 8px; font-size: 10px; font-weight: 700; color: #fff; background: ${color}; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px;">${label}</span>
        <p style="margin: 6px 0 2px; font-size: 14px; font-weight: 600; color: #111827;">${escapeHtml(alert.title)}</p>
        <p style="margin: 0; font-size: 12px; color: #6B7280; line-height: 1.4;">${escapeHtml(alert.description)}</p>
      </td>
    </tr>`;
}

function buildDigestHtml(
  brandName: string,
  alerts: AlertDoc[],
  metrics: PeriodMetrics,
): string {
  const date = new Date().toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const sortedAlerts = [...alerts].sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  ).slice(0, 5);

  const alertsSection = sortedAlerts.length > 0 ? `
    <div style="margin: 24px 0;">
      <h3 style="margin: 0 0 12px; font-size: 13px; color: #6B7280; text-transform: uppercase; letter-spacing: 1px;">Νέες Ειδοποιήσεις (${alerts.length})</h3>
      <table style="width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; border: 1px solid #E5E7EB;">
        ${sortedAlerts.map(buildAlertRow).join('')}
      </table>
      ${alerts.length > 5 ? `<p style="margin: 8px 0 0; font-size: 12px; color: #9CA3AF;">+${alerts.length - 5} ακόμα ειδοποιήσεις στην εφαρμογή</p>` : ''}
    </div>` : '';

  const kpiItems: string[] = [];
  if (metrics.paidSpend > 0 || metrics.paidRevenue > 0) {
    kpiItems.push(kpiCell('Paid ROAS', `${metrics.paidRoas.toFixed(2)}x`));
    kpiItems.push(kpiCell('Ad Spend', formatCurrency(metrics.paidSpend)));
    kpiItems.push(kpiCell('Paid Revenue', formatCurrency(metrics.paidRevenue)));
  }
  if (metrics.storeRevenue > 0 || metrics.storeOrders > 0) {
    kpiItems.push(kpiCell('Store Revenue', formatCurrency(metrics.storeRevenue)));
    kpiItems.push(kpiCell('Orders', metrics.storeOrders.toLocaleString('el-GR')));
  }

  const kpiSection = kpiItems.length > 0 ? `
    <div style="margin: 24px 0;">
      <h3 style="margin: 0 0 4px; font-size: 13px; color: #6B7280; text-transform: uppercase; letter-spacing: 1px;">KPI ημέρας</h3>
      <p style="margin: 0 0 12px; font-size: 12px; color: #9CA3AF;">Περίοδος αναφοράς: ${metrics.label}</p>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>${kpiItems.join('')}</tr>
      </table>
    </div>` : '';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #F9FAFB;">
      <div style="background: #111; border-radius: 12px 12px 0 0; padding: 20px 24px; text-align: center;">
        <span style="color: #fff; font-size: 18px; font-weight: 700;">Performance+</span>
        <span style="color: rgba(255,255,255,0.6); font-size: 13px; display: block; margin-top: 4px;">${escapeHtml(brandName)}</span>
      </div>
      <div style="background: #fff; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px; padding: 24px;">
        <p style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #111827;">Καλημέρα!</p>
        <p style="margin: 0 0 4px; font-size: 13px; color: #6B7280;">${date}</p>
        <p style="margin: 0 0 16px; font-size: 12px; color: #9CA3AF;">Σύνοψη απόδοσης για: ${metrics.label}</p>
        ${alertsSection}
        ${kpiSection}
        <div style="text-align: center; margin-top: 24px;">
          <a href="https://performanceplus.gr/#dashboard"
             style="display: inline-block; padding: 12px 32px; background: #F97316; color: #fff; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
            Ανοίξτε το Dashboard
          </a>
        </div>
      </div>
      <p style="text-align: center; margin-top: 16px; font-size: 11px; color: #9CA3AF;">
        Αυτό το email εστάλη αυτόματα από το Performance+ — Daily Digest · ${NOREPLY_EMAIL}
      </p>
    </div>`;
}

function kpiCell(label: string, value: string): string {
  return `
    <td style="padding: 12px; text-align: center; border: 1px solid #F3F4F6; background: #FAFAFA; border-radius: 6px;">
      <p style="margin: 0; font-size: 18px; font-weight: 700; color: #111827; font-family: 'SF Mono', Menlo, monospace;">${value}</p>
      <p style="margin: 4px 0 0; font-size: 11px; color: #6B7280;">${label}</p>
    </td>`;
}

async function sendDigestForBrand(brandId: string, brandName: string, transporter: Transporter): Promise<number> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const period = digestPeriod();

  const alertsSnap = await db().collection('automation_alerts')
    .where('brandId', '==', brandId)
    .where('status', '==', 'new')
    .get();

  const recentAlerts = alertsSnap.docs
    .map(d => d.data() as AlertDoc)
    .filter(a => a.createdAt >= oneDayAgo);

  const metrics = await loadPeriodMetrics(brandId, period);
  const hasData = metrics.paidSpend > 0 || metrics.paidRevenue > 0 || metrics.storeRevenue > 0 || metrics.storeOrders > 0;
  if (recentAlerts.length === 0 && !hasData) return 0;

  const html = buildDigestHtml(brandName, recentAlerts, metrics);

  const membersSnap = await db().collection('brands').doc(brandId).collection('members').get();
  if (membersSnap.empty) return 0;

  let sent = 0;
  for (const memberDoc of membersSnap.docs) {
    const userId = memberDoc.id;
    try {
      const prefsSnap = await db().doc(`brands/${brandId}/members/${userId}/settings/notifications`).get();
      if (prefsSnap.data()?.dailyDigestEmail !== true) continue;

      const userDoc = await db().collection('users').doc(userId).get();
      const userData = userDoc.data();
      const email = userData?.email || memberDoc.data()?.email;
      if (!email) continue;

      const subject = recentAlerts.length > 0
        ? `[Performance+] ${brandName} — ${recentAlerts.length} νέες ειδοποιήσεις`
        : `[Performance+] ${brandName} — Daily Digest (${period.dateKey})`;

      await transporter.sendMail({
        from: SENDER,
        to: email,
        subject,
        html,
      });

      sent++;
      logger.info(`[Digest] Sent to ${email} for brand ${brandName}`);
    } catch (err) {
      logger.warn(`[Digest] Failed for user ${userId}:`, err);
    }
  }

  return sent;
}

export async function sendDigestForAllBrands(
  smtp?: SmtpCredentialInput
): Promise<{ brands: number; emails: number }> {
  const transporter = createTransporter(smtp);
  if (!transporter) {
    logger.warn('[Digest] SMTP not configured — skipping daily digest');
    return { brands: 0, emails: 0 };
  }

  const brandsSnap = await db().collection('brands').get();
  let totalEmails = 0;
  let brandsProcessed = 0;

  for (const brandDoc of brandsSnap.docs) {
    try {
      const brandName = (brandDoc.data().name as string) || brandDoc.id;
      const sent = await sendDigestForBrand(brandDoc.id, brandName, transporter);
      totalEmails += sent;
      brandsProcessed++;
    } catch (err) {
      logger.error(`[Digest] Failed for brand ${brandDoc.id}:`, err);
    }
  }

  logger.info(`[Digest] Done: ${brandsProcessed} brands, ${totalEmails} emails sent`);
  return { brands: brandsProcessed, emails: totalEmails };
}
