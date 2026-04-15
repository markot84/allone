import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import type { Transporter } from 'nodemailer';
import { createTransporter, SENDER, NOREPLY_EMAIL, type SmtpCredentialInput } from './smtpConfig';

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

function buildAlertRow(alert: AlertDoc): string {
  const color = SEVERITY_COLORS[alert.severity] || '#6B7280';
  const label = SEVERITY_LABELS[alert.severity] || 'INFO';
  return `
    <tr>
      <td style="padding: 10px 16px; border-bottom: 1px solid #F3F4F6;">
        <span style="display: inline-block; padding: 2px 8px; font-size: 10px; font-weight: 700; color: #fff; background: ${color}; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px;">${label}</span>
        <p style="margin: 6px 0 2px; font-size: 14px; font-weight: 600; color: #111827;">${alert.title}</p>
        <p style="margin: 0; font-size: 12px; color: #6B7280; line-height: 1.4;">${alert.description}</p>
      </td>
    </tr>`;
}

function buildDigestHtml(
  brandName: string,
  alerts: AlertDoc[],
  products: ProductAgg | null,
  segments: SegmentAgg | null,
  campaigns: CampaignAgg | null,
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
  if (products && products.totalSkus > 0) {
    const deadPct = ((products.deadStock.count / products.totalSkus) * 100).toFixed(1);
    kpiItems.push(kpiCell('Προϊόντα', products.totalSkus.toLocaleString('el-GR')));
    kpiItems.push(kpiCell('Dead Stock', `${deadPct}%`));
    kpiItems.push(kpiCell('Αξία Αποθέματος', formatCurrency(products.totalInventoryValue)));
  }
  if (campaigns && campaigns.totalCampaigns > 0) {
    kpiItems.push(kpiCell('ROAS', `${campaigns.avgRoas.toFixed(2)}x`));
    kpiItems.push(kpiCell('Ad Spend', formatCurrency(campaigns.totalSpend)));
    kpiItems.push(kpiCell('Revenue (Paid)', formatCurrency(campaigns.totalRevenue)));
  }
  if (segments && segments.totalCustomers > 0) {
    kpiItems.push(kpiCell('Πελάτες', segments.totalCustomers.toLocaleString('el-GR')));
    kpiItems.push(kpiCell('At Risk', `${segments.atRiskPercentage.toFixed(1)}%`));
    kpiItems.push(kpiCell('Champions', `${segments.championsPercentage.toFixed(1)}%`));
  }

  const kpiSection = kpiItems.length > 0 ? `
    <div style="margin: 24px 0;">
      <h3 style="margin: 0 0 12px; font-size: 13px; color: #6B7280; text-transform: uppercase; letter-spacing: 1px;">KPI Snapshot</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>${kpiItems.join('')}</tr>
      </table>
    </div>` : '';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #F9FAFB;">
      <div style="background: #111; border-radius: 12px 12px 0 0; padding: 20px 24px; text-align: center;">
        <span style="color: #fff; font-size: 18px; font-weight: 700;">Performance+</span>
        <span style="color: rgba(255,255,255,0.6); font-size: 13px; display: block; margin-top: 4px;">${brandName}</span>
      </div>
      <div style="background: #fff; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px; padding: 24px;">
        <p style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #111827;">Καλημέρα!</p>
        <p style="margin: 0 0 16px; font-size: 13px; color: #6B7280;">${date}</p>
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

  const alertsSnap = await db().collection('automation_alerts')
    .where('brandId', '==', brandId)
    .where('status', '==', 'new')
    .get();

  const recentAlerts = alertsSnap.docs
    .map(d => d.data() as AlertDoc)
    .filter(a => a.createdAt >= oneDayAgo);

  const aggRef = db().collection('brands').doc(brandId).collection('aggregates');
  const [pSnap, sSnap, cSnap] = await Promise.all([
    aggRef.doc('products').get(),
    aggRef.doc('segments').get(),
    aggRef.doc('campaigns').get(),
  ]);

  const products = pSnap.exists ? (pSnap.data() as ProductAgg) : null;
  const segments = sSnap.exists ? (sSnap.data() as SegmentAgg) : null;
  const campaigns = cSnap.exists ? (cSnap.data() as CampaignAgg) : null;

  const hasData = products || segments || campaigns;
  if (recentAlerts.length === 0 && !hasData) return 0;

  const html = buildDigestHtml(brandName, recentAlerts, products, segments, campaigns);

  const membersSnap = await db().collection('brands').doc(brandId).collection('members').get();
  if (membersSnap.empty) return 0;

  let sent = 0;
  for (const memberDoc of membersSnap.docs) {
    const userId = memberDoc.id;
    try {
      const userDoc = await db().collection('users').doc(userId).get();
      const userData = userDoc.data();
      if (!userData?.email) continue;

      const prefs = userData.notificationPreferences;
      if (prefs && prefs.email === false) continue;

      const subject = recentAlerts.length > 0
        ? `[Performance+] ${brandName} — ${recentAlerts.length} νέες ειδοποιήσεις`
        : `[Performance+] ${brandName} — Daily Digest`;

      await transporter.sendMail({
        from: SENDER,
        to: userData.email,
        subject,
        html,
      });

      sent++;
      logger.info(`[Digest] Sent to ${userData.email} for brand ${brandName}`);
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
