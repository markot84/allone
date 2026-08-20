import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { logger } from './utils/logger';
import { createTransporter, SENDER, NOREPLY_EMAIL } from './smtpConfig';
import { escapeHtml } from './escapeHtml';

let _db: Firestore;
function db() {
  if (!_db) _db = getFirestore();
  return _db;
}

const REORDER_ROW_CAP = 40;
const DEFAULT_LEAD_DAYS = 30;
const DEFAULT_REORDER_MULTIPLIER = 1.5;
const NO_SUPPLIER_LABEL = 'Χωρίς προμηθευτή';

export interface ReorderRow {
  sku: string;
  name?: string;
  supplier?: string;
  stock_level?: number;
  qty_sold_period?: number;
  price?: number;
}

export interface SupplierDoc {
  name?: string;
  lead_time?: number;
}

export interface ReorderThresholds {
  defaultLeadTimeDays?: number;
  reorderWarningMultiplier?: number;
}

export interface ReorderGroup {
  supplier: string;
  leadTimeDays: number;
  reorderPointDays: number;
  rows: ReorderRow[];
  overflow: number;
  total: number;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Same normalization as supplierDocId, so page-row supplier strings match the suppliers collection. */
function normSupplier(name?: string | null): string {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('el-GR');
}

/** Bucket low-stock rows by supplier with lead time + reorder-point days per group; no-supplier rows last. */
export function groupReorderRows(
  rows: ReorderRow[],
  suppliers: SupplierDoc[],
  thresholds: ReorderThresholds,
): ReorderGroup[] {
  const leadByNorm = new Map<string, number>();
  for (const s of suppliers) {
    const key = normSupplier(s.name);
    if (key) leadByNorm.set(key, num(s.lead_time));
  }

  const defaultLead = num(thresholds.defaultLeadTimeDays) > 0 ? num(thresholds.defaultLeadTimeDays) : DEFAULT_LEAD_DAYS;
  const multiplier = num(thresholds.reorderWarningMultiplier) > 0 ? num(thresholds.reorderWarningMultiplier) : DEFAULT_REORDER_MULTIPLIER;

  const buckets = new Map<string, { label: string; rows: ReorderRow[] }>();
  for (const row of rows) {
    const key = normSupplier(row.supplier);
    const label = key ? String(row.supplier).trim() : NO_SUPPLIER_LABEL;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { label, rows: [] }; buckets.set(key, bucket); }
    bucket.rows.push(row);
  }

  const groups: ReorderGroup[] = [];
  for (const [key, bucket] of buckets) {
    const supplierLead = leadByNorm.get(key) ?? 0;
    const leadTimeDays = supplierLead > 0 ? supplierLead : defaultLead;
    groups.push({
      supplier: bucket.label,
      leadTimeDays,
      reorderPointDays: Math.round(leadTimeDays * multiplier),
      rows: bucket.rows.slice(0, REORDER_ROW_CAP),
      overflow: Math.max(0, bucket.rows.length - REORDER_ROW_CAP),
      total: bucket.rows.length,
    });
  }

  return groups.sort((a, b) => {
    const aNo = a.supplier === NO_SUPPLIER_LABEL ? 1 : 0;
    const bNo = b.supplier === NO_SUPPLIER_LABEL ? 1 : 0;
    if (aNo !== bNo) return aNo - bNo;
    return b.total - a.total;
  });
}

async function loadLowRows(brandId: string): Promise<ReorderRow[]> {
  const rows: ReorderRow[] = [];
  for (let page = 1; ; page += 1) {
    const snap = await db().doc(`product_intelligence_pages/${brandId}_low_${page}`).get();
    if (!snap.exists) break;
    const products = snap.data()?.products;
    if (Array.isArray(products)) {
      for (const p of products) {
        if (p?.sku) rows.push(p as ReorderRow);
      }
    }
  }
  return rows;
}

function buildGroupSection(group: ReorderGroup): string {
  const bodyRows = group.rows.map((r) => `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #F3F4F6; font-family: 'SF Mono', Menlo, monospace; font-size: 12px; color: #6B7280;">${escapeHtml(r.sku)}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #F3F4F6; font-size: 13px; color: #111827;">${escapeHtml(r.name ?? '')}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #F3F4F6; font-size: 13px; color: #111827; text-align: right;">${num(r.stock_level).toLocaleString('el-GR')}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #F3F4F6; font-size: 13px; color: #111827; text-align: right;">${num(r.qty_sold_period).toLocaleString('el-GR')}</td>
    </tr>`).join('');

  const overflow = group.overflow > 0
    ? `<p style="margin: 8px 0 0; font-size: 12px; color: #9CA3AF;">+${group.overflow} ακόμη</p>`
    : '';

  return `
    <div style="margin: 24px 0;">
      <h3 style="margin: 0 0 8px; font-size: 14px; font-weight: 700; color: #111827;">${escapeHtml(group.supplier)} — lead time ${group.leadTimeDays} ημέρες, σημείο επαναπαραγγελίας ${group.reorderPointDays} ημέρες</h3>
      <table style="width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; border: 1px solid #E5E7EB;">
        <tr style="background: #FAFAFA;">
          <th style="padding: 8px 12px; text-align: left; font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px;">SKU</th>
          <th style="padding: 8px 12px; text-align: left; font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px;">Προϊόν</th>
          <th style="padding: 8px 12px; text-align: right; font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px;">Απόθεμα</th>
          <th style="padding: 8px 12px; text-align: right; font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px;">Πωλήσεις/μήνα</th>
        </tr>
        ${bodyRows}
      </table>
      ${overflow}
    </div>`;
}

export function buildReorderHtml(brandName: string, groups: ReorderGroup[], productCount: number): string {
  const date = new Date().toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; background: #F9FAFB;">
      <div style="background: #111; border-radius: 12px 12px 0 0; padding: 20px 24px; text-align: center;">
        <span style="color: #fff; font-size: 18px; font-weight: 700;">Performance+</span>
        <span style="color: rgba(255,255,255,0.6); font-size: 13px; display: block; margin-top: 4px;">${escapeHtml(brandName)}</span>
      </div>
      <div style="background: #fff; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px; padding: 24px;">
        <p style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #111827;">Επαναπαραγγελίες</p>
        <p style="margin: 0 0 4px; font-size: 13px; color: #6B7280;">${date}</p>
        <p style="margin: 0 0 16px; font-size: 12px; color: #9CA3AF;">${productCount} προϊόντα σε Low Stock από ${groups.length} προμηθευτές</p>
        ${groups.map(buildGroupSection).join('')}
        <div style="text-align: center; margin-top: 24px;">
          <a href="https://performanceplus.gr/#dashboard"
             style="display: inline-block; padding: 12px 32px; background: #F97316; color: #fff; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
            Ανοίξτε το Dashboard
          </a>
        </div>
      </div>
      <p style="text-align: center; margin-top: 16px; font-size: 11px; color: #9CA3AF;">
        Αυτό το email εστάλη αυτόματα από το Performance+ — Reorder · ${NOREPLY_EMAIL}
      </p>
    </div>`;
}

export async function buildReorderEmailForBrand(
  brandId: string,
): Promise<{ html: string; subject: string; supplierCount: number; productCount: number } | null> {
  const [brandSnap, rows, suppliersSnap] = await Promise.all([
    db().collection('brands').doc(brandId).get(),
    loadLowRows(brandId),
    db().collection('suppliers').where('brandId', '==', brandId).get(),
  ]);
  if (rows.length === 0) return null;

  const brandData = brandSnap.data() || {};
  const brandName = (brandData.name as string) || brandId;
  const thresholds = (brandData.inventoryThresholds as ReorderThresholds) || {};
  const suppliers = suppliersSnap.docs.map((d) => d.data() as SupplierDoc);

  const groups = groupReorderRows(rows, suppliers, thresholds);
  if (groups.length === 0) return null;

  const html = buildReorderHtml(brandName, groups, rows.length);
  const safeBrandName = brandName.replace(/[\r\n]+/g, ' ');
  const subject = `Επαναπαραγγελίες — ${safeBrandName} — ${rows.length} προϊόντα από ${groups.length} προμηθευτές`;
  return { html, subject, supplierCount: groups.length, productCount: rows.length };
}

export async function sendReorderEmailForBrand(
  brandId: string,
  opts?: { dryRun?: boolean },
): Promise<{ sent: number; supplierCount: number; productCount: number }> {
  const built = await buildReorderEmailForBrand(brandId);
  if (!built) return { sent: 0, supplierCount: 0, productCount: 0 };

  // ponytail: one transporter per brand; brand count is small so no need to thread it through.
  const transporter = opts?.dryRun ? null : createTransporter();
  if (!opts?.dryRun && !transporter) {
    logger.warn('[Reorder] SMTP not configured — skipping reorder email');
    return { sent: 0, supplierCount: built.supplierCount, productCount: built.productCount };
  }

  const membersSnap = await db().collection('brands').doc(brandId).collection('members').get();
  let sent = 0;
  for (const memberDoc of membersSnap.docs) {
    const userId = memberDoc.id;
    try {
      const prefsSnap = await db().doc(`brands/${brandId}/members/${userId}/settings/notifications`).get();
      if (prefsSnap.data()?.dailyDigestEmail !== true) continue;

      const userDoc = await db().collection('users').doc(userId).get();
      const email = userDoc.data()?.email || memberDoc.data()?.email;
      if (!email) continue;

      if (opts?.dryRun) { sent++; continue; }

      await transporter!.sendMail({ from: SENDER, to: email, subject: built.subject, html: built.html });
      sent++;
      logger.info('[Reorder] Sent reorder email', { email, brandId });
    } catch (err) {
      logger.warn(`[Reorder] Failed for user ${userId}:`, { err });
    }
  }

  return { sent, supplierCount: built.supplierCount, productCount: built.productCount };
}

export async function sendReorderEmailsForAllBrands(): Promise<{ brands: number; emails: number }> {
  const brandsSnap = await db().collection('brands').get();
  let brandsProcessed = 0;
  let totalEmails = 0;

  for (const brandDoc of brandsSnap.docs) {
    if ((brandDoc.data().inventoryThresholds as ReorderThresholds & { reorderEmailEnabled?: boolean })?.reorderEmailEnabled !== true) continue;
    try {
      const { sent } = await sendReorderEmailForBrand(brandDoc.id);
      totalEmails += sent;
      brandsProcessed++;
    } catch (err) {
      logger.error(`[Reorder] Failed for brand ${brandDoc.id}:`, { err });
    }
  }

  logger.info(`[Reorder] Done: ${brandsProcessed} brands, ${totalEmails} emails sent`);
  return { brands: brandsProcessed, emails: totalEmails };
}
